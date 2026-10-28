// «Разметка»: comments right on a reference — a point («вот этот отступ»), a frame around a place, an arrow — each with
// its text, author and date. Stored in the optional field `notes` of the item: [{ id, kind: 'pin' | 'box' | 'arrow',
// x, y, x2, y2 (0..1 of the picture), text, by, t }]. In a team library `notes` is shared: everyone sees them
// (team.js writes the change into the person's journal). The Figma plugin draws them over the picture.
import './notes.css';
import { pushLayer, popLayer } from './layers.js';
import { S, ui } from '../state.js';
import { esc, uid } from '../util.js';
import { ic } from './icons.js';
import { assetUrl, saveIndex } from '../lib/library.js';
import { sfx } from './sound.js';
import { toast } from './dialogs.js';
import { readPref, writePref } from '../lib/prefs.js';
import { notesOf } from './notesblock.js';

let el = null, it = null, tool = 'pin', drag = null, editing = null;
export const isNotesOpen = () => !!(el && !el.hidden);
const who = () => readPref('perch.teams', { me: '' }).me || readPref('perch.notesBy', { name: '' }).name || '';
const when = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

function build() {
  el = document.createElement('section');
  el.className = 'nts';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Разметка');
  el.innerHTML = `<div class="nts-bar glass"><span class="orb-t">Разметка</span><span class="nts-name cap-sm"></span>` +
    `<span class="nts-tools" role="group" aria-label="Что ставить">` +
    `<button type="button" data-tool="pin" title="Точка с комментарием (P)">${ic('chat')}<span>Точка</span></button>` +
    `<button type="button" data-tool="box" title="Рамка вокруг места (R)">${ic('tRect')}<span>Рамка</span></button>` +
    `<button type="button" data-tool="arrow" title="Стрелка (A)">${ic('arrowu')}<span>Стрелка</span></button></span>` +
    `<button type="button" class="ib" data-nt="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>` +
    `<div class="nts-stage"><div class="nts-pic"><img alt=""><svg class="nts-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"></svg><div class="nts-marks"></div></div></div>` +
    `<aside class="nts-side glass" aria-label="Комментарии"></aside>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  el.addEventListener('submit', onSubmit);
  const pic = el.querySelector('.nts-pic');
  pic.addEventListener('pointerdown', down);
  pic.addEventListener('pointermove', move);
  pic.addEventListener('pointerup', up);
  pic.addEventListener('pointercancel', () => { drag = null; draw(); });
}

function onKey(e) {
  const typing = e.target.closest && e.target.closest('textarea, input');
  if (e.key === 'Escape') { e.preventDefault(); if (editing) { cancelEdit(); } else closeNotes(); }
  else if (!typing && !e.ctrlKey && !e.altKey) {
    const t = { KeyP: 'pin', KeyR: 'box', KeyA: 'arrow' }[e.code];
    if (t) { e.preventDefault(); setTool(t); }
  }
  if (typing && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form && e.target.form.requestSubmit(); }
  e.stopPropagation();
}
const setTool = (t) => { tool = t; sfx('tick'); el.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t))); };

function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.nt === 'close') closeNotes();
  else if (b.dataset.tool) setTool(b.dataset.tool);
  else if (b.dataset.del) {
    const n = notesOf(it).find((x) => x.id === b.dataset.del);
    it.notes = notesOf(it).filter((x) => x.id !== b.dataset.del);
    if (!it.notes.length) delete it.notes;
    save(); draw();
    toast('Комментарий удалён', 4000, { fn: () => { it.notes = [...notesOf(it), n]; save(); draw(); } });
  } else if (b.dataset.focus) { const m = el.querySelector(`.nts-m[data-id="${CSS.escape(b.dataset.focus)}"]`); if (m) { m.classList.add('hl'); setTimeout(() => m.classList.remove('hl'), 900); } }
  else if (b.dataset.cancel) cancelEdit();
}

/* ---------- placing a mark ---------- */
const rel = (e) => {
  const r = el.querySelector('.nts-pic img').getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
};
function down(e) {
  if (e.button !== 0 || editing || e.target.closest('.nts-m')) return;
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);
  const p = rel(e);
  drag = { kind: tool, x: p.x, y: p.y, x2: p.x, y2: p.y };
  draw();
}
function move(e) { if (!drag) return; const p = rel(e); drag.x2 = p.x; drag.y2 = p.y; draw(); }
function up() {
  if (!drag) return;
  const d = drag;
  drag = null;
  const far = Math.hypot(d.x2 - d.x, d.y2 - d.y) > 0.015;
  // a frame or an arrow needs a drag; a click makes a point whatever the tool
  const kind = d.kind === 'pin' || !far ? 'pin' : d.kind;
  const n = kind === 'box'
    ? { kind, x: Math.min(d.x, d.x2), y: Math.min(d.y, d.y2), x2: Math.max(d.x, d.x2), y2: Math.max(d.y, d.y2) }
    : kind === 'arrow' ? { kind, x: d.x, y: d.y, x2: d.x2, y2: d.y2 } : { kind, x: d.x, y: d.y };
  editing = { ...n, id: uid() };
  draw();
  const ta = el.querySelector('.nts-form textarea');
  if (ta) ta.focus();
}
function cancelEdit() { editing = null; draw(); }
function onSubmit(e) {
  e.preventDefault();
  const text = e.target.querySelector('textarea').value.trim();
  if (!editing) return;
  if (!text) { cancelEdit(); return; }
  it.notes = [...notesOf(it), { ...editing, text, by: who(), t: Date.now() }];
  editing = null;
  sfx('done');
  save(); draw();
}
function save() { saveIndex(); if (ui.renderInsp) ui.renderInsp(); }

/* ---------- drawing ---------- */
function draw() {
  const list = notesOf(it);
  const all = [...list, ...(editing ? [{ ...editing, draft: true }] : []), ...(drag ? [{ ...drag, draft: true }] : [])];
  // frames and arrows in one SVG over the picture (0..1000 both ways, stretched with it); points as numbered buttons
  el.querySelector('.nts-svg').innerHTML = `<defs><marker id="ntsArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>` +
    all.map((n) => n.kind === 'box' ? `<rect class="nts-box${n.draft ? ' draft' : ''}" x="${Math.min(n.x, n.x2) * 1000}" y="${Math.min(n.y, n.y2) * 1000}" width="${Math.abs(n.x2 - n.x) * 1000}" height="${Math.abs(n.y2 - n.y) * 1000}" rx="8"/>`
      : n.kind === 'arrow' ? `<line class="nts-arr${n.draft ? ' draft' : ''}" x1="${n.x * 1000}" y1="${n.y * 1000}" x2="${n.x2 * 1000}" y2="${n.y2 * 1000}" marker-end="url(#ntsArr)"/>` : '').join('');
  el.querySelector('.nts-marks').innerHTML = all.map((n, i) => {
    const at = n.kind === 'box' ? { x: Math.min(n.x, n.x2), y: Math.min(n.y, n.y2) } : { x: n.x, y: n.y };
    return n.draft && !n.id ? '' : `<button type="button" class="nts-m${n.draft ? ' draft' : ''}" data-id="${esc(n.id)}" style="left:${at.x * 100}%;top:${at.y * 100}%" title="${esc(n.text || '')}">${n.draft ? '+' : i + 1}</button>`;
  }).join('');
  const side = el.querySelector('.nts-side');
  const form = editing ? `<form class="nts-form"><textarea rows="3" placeholder="Комментарий: что здесь важно" aria-label="Текст комментария"></textarea><div class="nts-fb"><button type="button" class="ibtn flat" data-cancel="1">Отмена</button><button type="submit" class="ibtn pri">Добавить</button></div></form>` : '';
  const keep = side.querySelector('textarea') ? side.querySelector('textarea').value : '';
  side.innerHTML = `<h3 class="nts-h">Комментарии · ${list.length}</h3>${form}` +
    (list.length ? `<ol class="nts-list">${list.map((n, i) => `<li><button type="button" class="nts-n" data-focus="${esc(n.id)}">${i + 1}</button><div><p>${esc(n.text)}</p><small>${esc(n.by || 'без подписи')} · ${when(n.t)}${n.kind !== 'pin' ? ` · ${n.kind === 'box' ? 'рамка' : 'стрелка'}` : ''}</small></div><button type="button" class="ib" data-del="${esc(n.id)}" aria-label="Удалить комментарий ${i + 1}" title="Удалить">${ic('x')}</button></li>`).join('')}</ol>`
      : editing ? '' : '<p class="nts-p">Щёлкните по картинке — точка с комментарием. Протяните с «Рамкой» или «Стрелкой», чтобы показать место.</p>');
  const ta = side.querySelector('textarea');
  if (ta && keep) ta.value = keep;
}

/* ---------- open / close ---------- */
export async function openNotes(item) {
  if (!item || !item.thumb && !item.file) return;
  if (!el) build();
  it = item; tool = 'pin'; editing = null; drag = null;
  if (!who()) {
    const { ask } = await import('./dialogs.js');
    const name = await ask('Как подписывать ваши комментарии?', '');
    if (name) writePref('perch.notesBy', { name });
  }
  const img = el.querySelector('.nts-pic img');
  const pic = it.kind === 'image' && it.file && !/\.(psd|psb|tiff?)$/i.test(it.file) ? it.file : it.preview || it.thumb;
  img.src = assetUrl(pic);
  // fitted to the stage: a small picture (a model's render, an icon) is drawn large enough to point at its details
  img.decode().then(() => fit()).catch(() => {});
  el.querySelector('.nts-name').textContent = it.name;
  el.hidden = false;
  pushLayer({ el, title: 'Разметка', close: closeNotes, onKey });
  sfx('open');
  setTool('pin');
  draw();
}
function fit() {
  if (!isNotesOpen()) return;
  const img = el.querySelector('.nts-pic img'), st = el.querySelector('.nts-stage').getBoundingClientRect();
  const k = Math.min(st.width / (img.naturalWidth || 1), st.height / (img.naturalHeight || 1), 3);
  img.style.width = Math.round(img.naturalWidth * k) + 'px';
  img.style.height = Math.round(img.naturalHeight * k) + 'px';
}
addEventListener('resize', () => { if (isNotesOpen()) fit(); });

export function closeNotes() {
  if (!isNotesOpen()) return;
  el.hidden = true;
  popLayer(el);
  el.querySelector('.nts-pic img').removeAttribute('src');
  it = null; editing = null;
  sfx('close');
}

