// «Сценарий из записи экрана»: a screen recording → its screens (lib/flows.js) → a review window (uncheck the extra
// ones, name the flow) → a collection marked as a flow: the screens in order, numbered steps on the cards.
// The collection gets two optional fields, `flow: true` and `order: [ids]` — no migration needed.
import './flows.css';
import { S, ui } from '../state.js';
import { esc, plural, uid } from '../util.js';
import { ic } from './icons.js';
import { addFromBlobs, saveIndex } from '../lib/library.js';
import { setView } from '../lib/filter.js';
import { screensOf } from '../lib/flows.js';
import { toast } from './dialogs.js';
import { pixLoader } from './pixload.js';
import { sfx } from './sound.js';

let el = null, shots = [], off = new Set(), cancel = false, url = null, loader = null;
export const isFlowOpen = () => !!(el && !el.hidden);

function build() {
  el = document.createElement('section');
  el.className = 'flw';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Сценарий из записи экрана');
  el.innerHTML = `<div class="flw-bar glass"><span class="orb-t">Сценарий</span>` +
    `<input class="flw-name" type="text" placeholder="Название сценария" aria-label="Название сценария" spellcheck="false">` +
    `<span class="flw-sum cap-sm" aria-live="polite"></span>` +
    `<button type="button" class="ibtn pri" data-fl="save" disabled>Сохранить</button>` +
    `<button type="button" class="ib" data-fl="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>` +
    '<div class="flw-body"></div>';
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fl]');
    if (b) { if (b.dataset.fl === 'close') closeFlow(); else if (b.dataset.fl === 'save') save(); return; }
    const c = e.target.closest('.flw-c');
    if (c) toggle(+c.dataset.i);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeFlow(); }
    else if (e.key === 'Enter' && e.target.classList.contains('flw-name')) save();
    else if ((e.key === ' ' || e.key === 'Enter') && e.target.classList.contains('flw-c')) { e.preventDefault(); toggle(+e.target.dataset.i); }
    e.stopPropagation(); // the grid's shortcuts stay off
  });
}

function toggle(i) {
  if (off.has(i)) off.delete(i); else off.add(i);
  sfx(off.has(i) ? 'off' : 'on');
  draw();
}

function sum() {
  const n = shots.length - off.size;
  el.querySelector('.flw-sum').textContent = shots.length ? `${n} из ${shots.length} ${plural(shots.length, ['экрана', 'экранов', 'экранов'])}` : '';
  el.querySelector('[data-fl="save"]').disabled = !n;
  el.querySelector('[data-fl="save"]').textContent = n ? `Сохранить ${n} ${plural(n, ['экран', 'экрана', 'экранов'])}` : 'Сохранить';
}

const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function draw() {
  const body = el.querySelector('.flw-body');
  let step = 0;
  const auto = shots.filter((x) => x.dup >= 0 || x.empty).length;
  body.innerHTML = `<p class="flw-hint">Клик убирает экран из сценария или возвращает его.${auto ? ` Повторы и экраны загрузки (${auto}) уже выключены.` : ''}</p><div class="flw-grid">` +
    shots.map((s, i) => {
      const on = !off.has(i);
      if (on) step++;
      return `<div class="flw-c${on ? '' : ' off'}" data-i="${i}" tabindex="0" role="checkbox" aria-checked="${on}" aria-label="Экран на ${fmtT(s.t)}">` +
        `<div class="flw-ph"><img src="${s.thumb}" alt="" draggable="false"><span class="flw-n">${on ? String(step).padStart(2, '0') : '—'}</span></div>` +
        `<span class="flw-t cap-sm">${fmtT(s.t)}${s.empty ? ' · загрузка' : s.dup >= 0 ? ` · повтор ${fmtT(shots[s.dup].t)}` : ''}</span></div>`;
    }).join('') + '</div>';
  sum();
}

async function run(src, name) {
  if (!el) build();
  cancel = false; shots = []; off = new Set();
  el.hidden = false;
  document.body.classList.add('flow-on');
  sfx('open');
  const inp = el.querySelector('.flw-name');
  inp.value = name || '';
  const body = el.querySelector('.flw-body');
  body.innerHTML = '<div class="flw-wait"></div>';
  loader = pixLoader('Смотрю запись…', { variant: 'scan' });
  body.firstChild.appendChild(loader.el);
  sum();
  try {
    url = await src();
    shots = await screensOf(url, (p, n) => loader && loader.set(`Смотрю запись · ${Math.round(p * 100)} % · ${n} ${plural(n, ['экран', 'экрана', 'экранов'])}`), () => cancel);
  } catch (e) {
    if (cancel) return;
    body.innerHTML = `<p class="flw-empty">Не получилось прочитать видео: ${esc(e.message || String(e))}. Попробуйте MP4 или MOV (H.264) — запись экрана iPhone, Android или macOS.</p>`;
    sfx('error');
    return;
  } finally { if (loader) { loader.stop(); loader = null; } }
  if (cancel) return;
  if (!shots.length) { body.innerHTML = '<p class="flw-empty">В записи не нашлось экранов, на которых картинка стоит дольше полсекунды.</p>'; return; }
  sfx('done');
  // a screen seen before (back navigation) and a loading screen start unchecked: one click brings either back
  shots.forEach((x, i) => { if (x.dup >= 0 || x.empty) off.add(i); });
  draw();
  inp.focus(); inp.select();
}

// a video of the library
export function flowFromItem(it) {
  return run(async () => {
    const { fileBlob } = await import('./media.js');
    return URL.createObjectURL(await fileBlob(it));
  }, it.name);
}
// a recording from the disk (the browser's picker works in the app too: the file is read in memory)
export function flowFromDisk() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'video/*,.mp4,.mov,.webm,.m4v';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) flowFromFile(f); };
  inp.click();
}
export const flowFromFile = (f) => run(async () => URL.createObjectURL(f), f.name.replace(/\.[^.]+$/, ''));

export function closeFlow() {
  if (!el || el.hidden) return;
  cancel = true;
  if (loader) { loader.stop(); loader = null; }
  if (url) { URL.revokeObjectURL(url); url = null; }
  shots = [];
  el.hidden = true;
  document.body.classList.remove('flow-on');
  sfx('close');
}

async function save() {
  const keep = shots.filter((_, i) => !off.has(i));
  if (!keep.length) return;
  const name = el.querySelector('.flw-name').value.trim() || 'Сценарий';
  const fid = uid();
  S.folders.push({ id: fid, name, parent: null, open: true, flow: true, order: [] });
  const w = Math.max(2, String(keep.length).length);
  const list = keep.map((s, i) => ({ blob: s.blob, name: `${name} — ${String(i + 1).padStart(w, '0')}.png` }));
  const times = keep.map((s) => Math.round(s.t * 10) / 10);
  closeFlow();
  const added = await addFromBlobs(list, { folder: fid });
  // the import runs three at a time: the order comes back from the step numbers in the names
  const f = S.folders.find((x) => x.id === fid);
  const ordered = added.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  if (f) f.order = ordered.map((x) => x.id);
  ordered.forEach((x, i) => { x.flowT = times[i]; }); // the second of the recording (optional field): step timing in Figma
  saveIndex();
  setView('folder', fid);
  ui.renderSide && ui.renderSide();
  toast(`Сценарий «${name}»: ${added.length} ${plural(added.length, ['экран', 'экрана', 'экранов'])}`, 3500);
}
