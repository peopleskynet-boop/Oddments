// A flow collection (a screen recording cut into screens, flows.js) seen as what it is:
// «Раскадровка» — the steps in a row with arrows, «Шаг 01 · 0:12» over each, the recording's length and the step count;
// «Пройти» — one step at a time in a phone frame, click / → / Space for the next step, ← for the previous, Esc to leave.
// Both are layers over everything, built on open (lazy) and gone on close.
import './storyboard.css';
import { S, folderById } from '../state.js';
import { esc, plural } from '../util.js';
import { ic } from './icons.js';
import { assetUrl } from '../lib/library.js';
import { sfx } from './sound.js';

let el = null, steps = [], at = 0, mode = 'board', title = '';
const fmtT = (t) => (t == null ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
const pic = (it) => assetUrl(it.kind === 'image' ? it.file : it.thumb || it.file);
export const isStoryOpen = () => !!(el && !el.hidden);

function stepsOf(fid) {
  const f = folderById(fid);
  if (!f || !f.flow) return [];
  return (f.order || []).map((id) => S.byId.get(id)).filter((it) => it && !it.trashed);
}

function drawBoard() {
  const last = steps[steps.length - 1];
  el.querySelector('.sb-sub').textContent = `${steps.length} ${plural(steps.length, ['шаг', 'шага', 'шагов'])}${last && last.flowT != null ? ' · ' + fmtT(last.flowT) + ' записи' : ''}`;
  el.querySelector('.sb-body').innerHTML = `<div class="sb-row">${steps.map((it, i) => `${i ? `<span class="sb-arrow" aria-hidden="true">${ic('right')}</span>` : ''}<figure class="sb-step" data-go="${i}" tabindex="0" title="Пройти с этого шага">
      <figcaption><b>Шаг ${String(i + 1).padStart(2, '0')}</b><span>${esc(fmtT(it.flowT))}</span></figcaption>
      <img src="${pic(it)}" alt="Шаг ${i + 1}" draggable="false"></figure>`).join('')}</div>`;
}
function drawWalk() {
  const it = steps[at];
  el.querySelector('.sb-sub').textContent = `Шаг ${at + 1} из ${steps.length}${it.flowT != null ? ' · ' + fmtT(it.flowT) : ''}`;
  el.querySelector('.sb-body').innerHTML = `<div class="sb-walk">
      <button type="button" class="ib sb-nav" data-nav="-1" aria-label="Предыдущий шаг" ${at ? '' : 'disabled'}>${ic('left')}</button>
      <div class="sb-phone" data-nav="1" title="Клик — следующий шаг"><img src="${pic(it)}" alt="Шаг ${at + 1}" draggable="false"></div>
      <button type="button" class="ib sb-nav" data-nav="1" aria-label="Следующий шаг" ${at < steps.length - 1 ? '' : 'disabled'}>${ic('right')}</button>
    </div>
    <div class="sb-dots" role="tablist">${steps.map((_, i) => `<button type="button" class="${i === at ? 'on' : ''}" data-go="${i}" aria-label="Шаг ${i + 1}"></button>`).join('')}</div>`;
}
function draw() {
  el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  if (mode === 'board') drawBoard(); else drawWalk();
}

function build() {
  el = document.createElement('section');
  el.className = 'sb-layer';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<header class="sb-top"><div><h2 class="sb-t"></h2><span class="sb-sub cap-sm"></span></div>
      <div class="sb-seg" role="group" aria-label="Вид"><button type="button" data-mode="board">Раскадровка</button><button type="button" data-mode="walk">Пройти</button></div>
      <button type="button" class="ib" data-sb="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></header>
    <div class="sb-body"></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { mode = m.dataset.mode; sfx('tick'); draw(); return; }
    if (e.target.closest('[data-sb="close"]')) { closeStory(); return; }
    const g = e.target.closest('[data-go]');
    if (g) { at = +g.dataset.go; mode = 'walk'; sfx('tick'); draw(); return; }
    const n = e.target.closest('[data-nav]');
    if (n && !n.disabled) go(+n.dataset.nav);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (mode === 'walk') { mode = 'board'; draw(); } else closeStory(); }
    else if (mode === 'walk' && (e.key === 'ArrowRight' || e.key === ' ')) { e.preventDefault(); go(1); }
    else if (mode === 'walk' && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (mode === 'board' && e.key === 'Enter' && e.target.dataset.go) { at = +e.target.dataset.go; mode = 'walk'; draw(); }
    e.stopPropagation(); // the grid's shortcuts stay off
  });
}
function go(d) {
  const n = Math.max(0, Math.min(steps.length - 1, at + d));
  if (n === at) return;
  at = n; sfx('tick'); draw();
}

export function openStory(fid, how = 'board') {
  steps = stepsOf(fid);
  if (!steps.length) return false;
  if (!el) build();
  title = (folderById(fid) || {}).name || 'Сценарий';
  el.querySelector('.sb-t').textContent = title;
  el.setAttribute('aria-label', title);
  mode = how; at = 0;
  el.hidden = false;
  document.body.classList.add('story-on');
  sfx('open');
  draw();
  el.querySelector('[data-mode="' + mode + '"]').focus({ preventScroll: true });
  return true;
}
export function closeStory() {
  if (!el || el.hidden) return;
  el.hidden = true;
  document.body.classList.remove('story-on');
  sfx('close');
}
