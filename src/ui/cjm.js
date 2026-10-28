// «CJM» — the third view of a flow collection next to «Раскадровка» and «Пройти» (storyboard.js): the steps as the
// map's columns, stages over them, the lanes under them — action, goal, the emotion curve, pains, opportunities — and
// what the recording says (waits, going back, long steps) as hints one click adds to the pains. Everything is written
// into the collection's optional `cjm` field (../lib/cjm.js) as it is typed. Out: PNG here, a board in Figma/FigJam
// through the Oddments plugin (the collection's «CJM» button there).
import './cjm.css';
import { studyFlows } from './studyview.js';
import { aggregate, studyHints } from '../lib/study.js';
import { esc } from '../util.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { folderById } from '../state.js';
import { assetUrl, saveIndex } from '../lib/library.js';
import * as C from '../lib/cjm.js';

const COL = 240;
let box = null, fid = null, steps = [], map = null, saveT = null;
const pic = (it) => assetUrl(it.kind === 'image' ? it.file : it.thumb || it.file);
const fmtT = (t) => (t == null ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
const sec = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

function keep() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    const f = folderById(fid);
    if (f && C.blank(f.cjm)) delete f.cjm; // nothing written: the collection stays as it was
    saveIndex();
    try { (await import('../lib/bridge.js')).pushCatalog(); } catch (e) { /* the web build */ }
  }, 400);
}

function feelSvg() {
  const n = steps.length, H = 150, y = (v) => 18 + ((2 - v) / 4) * (H - 36), x = (i) => i * COL + COL / 2;
  const pts = steps.map((it, i) => [i, map.steps[it.id] && map.steps[it.id].feel]).filter((p) => p[1] != null);
  const line = pts.map(([i, v]) => `${x(i)},${y(v)}`).join(' ');
  return `<svg class="cj-feel" width="${n * COL}" height="${H}" viewBox="0 0 ${n * COL} ${H}" role="group" aria-label="Кривая эмоций">
    ${C.FEELS.map(([v]) => `<line x1="0" x2="${n * COL}" y1="${y(v)}" y2="${y(v)}" class="cj-fl${v === 0 ? ' mid' : ''}"/>`).join('')}
    ${pts.length > 1 ? `<polyline points="${line}" class="cj-fc"/>` : ''}
    ${steps.map((it, i) => C.FEELS.map(([v, t]) => {
      const on = map.steps[it.id] && map.steps[it.id].feel === v;
      return `<circle cx="${x(i)}" cy="${y(v)}" r="${on ? 8 : 5}" class="cj-fd${on ? ' on' : ''}${on && v < 0 ? ' neg' : ''}" data-feel="${v}" data-id="${it.id}" tabindex="0" role="radio" aria-checked="${on}" aria-label="Шаг ${i + 1}: ${t}"><title>Шаг ${i + 1}: ${t}${on ? ' — ещё клик уберёт' : ''}</title></circle>`;
    }).join('')).join('')}
  </svg>`;
}

function draw() {
  const n = steps.length, st = C.stagesOf(map, n), tips = withStudy(C.hints(steps));
  const cols = `150px repeat(${n}, ${COL}px)`;
  const lane = (k, label, hint) => `<div class="cj-lab" title="${esc(hint)}">${esc(label)}</div>`
    + steps.map((it) => `<div class="cj-c"><textarea data-k="${k}" data-id="${it.id}" rows="3" placeholder="${esc(hint)}">${esc((map.steps[it.id] || {})[k] || '')}</textarea></div>`).join('');
  box.innerHTML = `<div class="cj-tools">
      <button type="button" class="pill ghost" data-cj="auto" title="Границы этапов там, где экраны меняются сильнее всего">${ic('flow')}<span>Предложить этапы</span></button>
      <button type="button" class="pill ghost" data-cj="png" title="Вся карта одной картинкой">${ic('download')}<span>Сохранить PNG</span></button>
      <span class="cj-note cap-sm">В Figma и FigJam: плагин Oddments › эта подборка › «CJM»</span></div>
    <div class="cj-scroll"><div class="cj-grid" style="grid-template-columns:${cols}">
      <div class="cj-lab">Этап</div>
      ${st.map((s, i) => `<div class="cj-stage" style="grid-column:span ${s.to - s.from}">
        <input type="text" data-stage="${s.from}" value="${esc(s.name)}" placeholder="Этап ${i + 1}" aria-label="Название этапа ${i + 1}" autocomplete="off">
        ${s.from ? `<button type="button" class="cj-x" data-merge="${s.from}" title="Слить с предыдущим этапом" aria-label="Слить этап ${i + 1} с предыдущим">${ic('x')}</button>` : ''}</div>`).join('')}
      <div class="cj-lab">Экран</div>
      ${steps.map((it, i) => {
        const d = C.dwell(steps, i), cut = i && !st.some((s) => s.from === i);
        return `<figure class="cj-shot"><figcaption><b>Шаг ${String(i + 1).padStart(2, '0')}</b><span>${esc(fmtT(it.flowT))}${d != null ? ` · ${sec(d)} с` : ''}</span></figcaption>
          <img src="${pic(it)}" alt="Шаг ${i + 1}" draggable="false" loading="lazy">
          ${cut ? `<button type="button" class="cj-cut" data-split="${i}" title="Новый этап с этого шага">${ic('plus')}<span>Этап отсюда</span></button>` : ''}</figure>`;
      }).join('')}
      ${lane('act', 'Действие', 'Что человек делает')}
      ${lane('goal', 'Цель', 'Чего хочет добиться')}
      <div class="cj-lab">Эмоция<small>радость ↑ раздражение ↓</small></div>
      <div class="cj-c cj-fw" style="grid-column:span ${n}">${feelSvg()}</div>
      ${lane('pain', 'Боли', 'Что мешает')}
      <div class="cj-lab">Из записи<small>клик — в боли</small></div>
      ${tips.map((list, i) => `<div class="cj-c cj-hints">${list.map((h) => `<button type="button" class="cj-hint" data-hint="${esc(h.text)}" data-id="${steps[i].id}" title="Добавить в «Боли»">${esc(h.text)}</button>`).join('')}</div>`).join('')}
      ${lane('idea', 'Возможности', 'Что улучшить')}
    </div></div>`;
}

async function onClick(e) {
  const t = e.target.closest('[data-cj],[data-split],[data-merge],[data-feel],[data-hint]');
  if (!t) return;
  if (t.dataset.split) { C.splitAt(map, +t.dataset.split); sfx('tick'); keep(); draw(); return; }
  if (t.dataset.merge) { C.mergeAt(map, +t.dataset.merge); sfx('tick'); keep(); draw(); return; }
  if (t.dataset.feel != null) {
    const c = C.cell(map, t.dataset.id), v = +t.dataset.feel;
    if (c.feel === v) delete c.feel; else c.feel = v;
    sfx('tick'); keep();
    const s = box.querySelector('.cj-scroll').scrollLeft;
    draw(); box.querySelector('.cj-scroll').scrollLeft = s;
    return;
  }
  if (t.dataset.hint) {
    const c = C.cell(map, t.dataset.id), h = t.dataset.hint;
    if ((c.pain || '').includes(h)) { toast('Уже в «Боли»'); return; }
    c.pain = c.pain ? c.pain.trimEnd() + '\n' + h : h;
    const ta = box.querySelector(`textarea[data-k="pain"][data-id="${t.dataset.id}"]`);
    if (ta) ta.value = c.pain;
    t.classList.add('used'); sfx('tick'); keep();
    return;
  }
  if (t.dataset.cj === 'auto') {
    const before = map.stages.map((s) => ({ ...s }));
    const cuts = await C.proposeStages(steps);
    map.stages = cuts.map((from) => ({ name: '', from }));
    keep(); draw(); sfx('done');
    // the old stages (with their names) come back from the toast
    toast(`Этапов: ${cuts.length} — там, где экраны меняются сильнее. Назовите их; «Этап отсюда» и × двигают границы`, 7000,
      before.length ? { fn: () => { map.stages = before; keep(); draw(); } } : null);
  } else if (t.dataset.cj === 'png') savePng();
}

async function savePng() {
  const f = folderById(fid), name = (f && f.name) || 'Сценарий';
  const blob = await C.renderPng(name, steps, map);
  if (!blob) { toast('Не получилось нарисовать карту'); return; }
  const file = `${name} — CJM.png`.replace(/[\\/:*?"<>|]+/g, '_');
  if (window.__TAURI_INTERNALS__) {
    try {
      const path = await (await import('@tauri-apps/plugin-dialog')).save({ title: 'Сохранить CJM', defaultPath: file, filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (!path) return;
      await (await import('@tauri-apps/plugin-fs')).writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      toast('CJM сохранена'); sfx('done');
    } catch (e) { toast('Не удалось сохранить: ' + (e.message || e)); }
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
}

// → into `host` (the storyboard's body); returns false when the collection has no steps
// a flow in a study (several respondents, studyview.js): what all of them did joins the hints of this recording
function withStudy(tips) {
  const flows = studyFlows(fid);
  if (flows.length < 2) return tips;
  const sh = studyHints(aggregate(flows));
  return tips.map((t, i) => [...(sh[i] || []), ...t]);
}

export function mountCjm(host, folderId, list) {
  const f = folderById(folderId);
  if (!f || !list.length) return false;
  fid = folderId; steps = list; map = C.cjmOf(f);
  box = document.createElement('div');
  box.className = 'cj';
  host.replaceChildren(box);
  draw();
  box.addEventListener('click', onClick);
  box.addEventListener('input', (e) => {
    const ta = e.target;
    if (ta.matches('textarea[data-k]')) { C.cell(map, ta.dataset.id)[ta.dataset.k] = ta.value; keep(); }
    else if (ta.matches('input[data-stage]')) { C.nameStage(map, +ta.dataset.stage, ta.value); keep(); }
  });
  box.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-feel]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  return true;
}
// leaving the view: a map with nothing written in it is not kept in the collection
export function unmountCjm() {
  const f = fid && folderById(fid);
  if (f && C.blank(f.cjm)) delete f.cjm;
  box = null;
}
