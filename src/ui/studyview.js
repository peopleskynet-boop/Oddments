// «Исследование» in a flow's window (storyboard.js): the respondents of one scenario, notes at the steps (problem /
// quote / insight, with the second of the recording), what all the recordings say together, and the report (lib/study.js).
import './study.css';
import { S, folderById } from '../state.js';
import { esc, uid, plural } from '../util.js';
import { ic } from './icons.js';
import { assetUrl, saveIndex } from '../lib/library.js';
import { toast, choose } from './dialogs.js';
import { sfx } from './sound.js';
import { aggregate, reportMd, NOTE_KINDS } from '../lib/study.js';
import { t } from '../lib/i18n.js';

let box = null, fid = null, sel = 0, kind = 'problem';
const fmtT = (t) => (t == null ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
const stepsOf = (f) => (f.order || []).map((id) => S.byId.get(id)).filter((it) => it && !it.trashed);
const pic = (it) => assetUrl(it.kind === 'image' ? it.file : it.thumb || it.file);
const kindName = (k) => (NOTE_KINDS.find(([x]) => x === k) || [, k])[1];

// the flows of the study this collection is in (itself alone when it is in none)
export function studyFlows(id) {
  const f = folderById(id);
  if (!f) return [];
  const sid = f.study && f.study.id;
  const list = sid ? S.folders.filter((x) => x.flow && x.study && x.study.id === sid) : [f];
  return list.map((x) => ({ id: x.id, name: x.name, resp: (x.study && x.study.resp) || x.name, steps: stepsOf(x), notes: x.rnotes || [] }));
}

export function mountStudy(host, folderId) {
  fid = folderId; sel = 0;
  box = document.createElement('div');
  box.className = 'st';
  host.replaceChildren(box);
  box.addEventListener('click', onClick);
  box.addEventListener('change', onChange);
  box.addEventListener('submit', onSubmit);
  draw();
}

function draw() {
  const f = folderById(fid);
  if (!f) return;
  const flows = studyFlows(fid), me = flows.find((x) => x.id === fid), agg = aggregate(flows);
  const steps = me.steps, notes = f.rnotes || [];
  const by = (id) => notes.filter((n) => n.step === id);
  sel = Math.min(sel, Math.max(0, steps.length - 1));
  const cur = steps[sel];
  box.innerHTML = `<div class="st-main">
    <div class="st-resp"><label>Респондент <input type="text" data-resp value="${esc(me.resp)}" aria-label="Имя респондента"></label>
      ${flows.filter((x) => x.id !== fid).map((x) => `<button type="button" class="st-chip" data-open="${esc(x.id)}" title="Открыть запись этого респондента">${esc(x.resp)}</button>`).join('')}
      <button type="button" class="st-chip add" data-add="1">+ Респондент</button></div>
    <div class="st-steps">${steps.map((it, i) => `<button type="button" class="st-step${i === sel ? ' on' : ''}" data-step="${i}" aria-pressed="${i === sel}"><img src="${pic(it)}" alt="" loading="lazy"><b>${String(i + 1).padStart(2, '0')}</b>${by(it.id).length ? `<i>${by(it.id).length}</i>` : ''}</button>`).join('')}</div>
    ${cur ? `<form class="st-form"><div class="st-kinds" role="group" aria-label="Что это">${NOTE_KINDS.map(([k, n]) => `<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${n}</button>`).join('')}</div>
      <textarea rows="2" placeholder="Шаг ${sel + 1}${cur.flowT != null ? ', ' + fmtT(cur.flowT) : ''}: что произошло, что сказал респондент" aria-label="Заметка к шагу ${sel + 1}"></textarea>
      <button type="submit" class="ibtn pri">Добавить к шагу ${sel + 1}</button></form>` : ''}
    <div class="st-notes">${steps.map((it, i) => by(it.id).length ? `<section><h4>Шаг ${i + 1}${it.flowT != null ? ` · ${fmtT(it.flowT)}` : ''}</h4>${by(it.id).map((n) => `<p class="st-n ${n.kind}"><span>${kindName(n.kind)}</span>${n.kind === 'quote' ? `«${esc(n.text)}»` : esc(n.text)}<button type="button" class="ib" data-del="${esc(n.id)}" aria-label="Удалить заметку">${ic('x')}</button></p>`).join('')}</section>` : '').join('') || '<p class="st-p">Выберите шаг и запишите, что на нём произошло: проблему, слова респондента, вывод.</p>'}</div>
  </div>
  <aside class="st-side glass"><h3 class="st-h">Итоги · ${agg.n} ${plural(agg.n, ['респондент', 'респондента', 'респондентов'])}</h3>
    ${agg.sentences.length ? `<ul class="st-sum">${agg.sentences.slice(0, 8).map((s) => `<li>${esc(s.text)}</li>`).join('')}</ul>` : '<p class="st-p">Записи пока не показали затруднений. Добавьте респондентов и заметки.</p>'}
    <p class="st-p mut">Шаги разных записей сравниваются по номеру. Эти же итоги — в строке «Из записи» на CJM.</p>
    <div class="st-acts"><button type="button" class="ibtn pri" data-report="save">${ic('download')}Отчёт .md</button><button type="button" class="ibtn" data-report="copy">${ic('copy')}Копировать</button></div></aside>`;
}

function onChange(e) {
  if (e.target.matches('[data-resp]')) {
    const f = folderById(fid);
    f.study = { id: (f.study && f.study.id) || uid(), resp: e.target.value.trim() || f.name };
    saveIndex(); draw();
  }
}
async function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const f = folderById(fid);
  if (b.dataset.step) { sel = +b.dataset.step; draw(); const ta = box.querySelector('.st-form textarea'); if (ta) ta.focus(); }
  else if (b.dataset.kind) { kind = b.dataset.kind; box.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.kind === kind))); }
  else if (b.dataset.del) { f.rnotes = (f.rnotes || []).filter((n) => n.id !== b.dataset.del); if (!f.rnotes.length) delete f.rnotes; saveIndex(); draw(); }
  else if (b.dataset.open) import('./storyboard.js').then((m) => m.openStory(b.dataset.open, 'study'));
  else if (b.dataset.add) {
    const sid = (f.study && f.study.id) || uid();
    const free = S.folders.filter((x) => x.flow && x.id !== fid && !(x.study && x.study.id === sid));
    if (!free.length) { toast('Другие записи этого сценария появятся здесь: «Добавить › Сценарий из записи экрана…»', 6000); return; }
    const id = await choose('Запись какого респондента добавить?', 'Шаги записей сравниваются по номеру — подойдёт запись того же сценария.', free.slice(0, 6).map((x, i) => ({ label: x.name, value: x.id, pri: i === 0 })));
    if (!id) return;
    f.study = { id: sid, resp: (f.study && f.study.resp) || f.name };
    const o = folderById(id);
    o.study = { id: sid, resp: (o.study && o.study.resp) || o.name };
    saveIndex(); sfx('done'); draw();
  } else if (b.dataset.report) {
    const md = reportMd(f.name.replace(/\s*·.*$/, '') || t('Исследование'), studyFlows(fid));
    if (b.dataset.report === 'copy') { try { await navigator.clipboard.writeText(md); toast('Отчёт скопирован — вставьте в Confluence, чат или документ'); } catch (err) { toast('Не удалось скопировать отчёт'); } return; }
    await saveMd(md, `${f.name || t('Исследование')} — ${t('отчёт')}.md`);
  }
}
function onSubmit(e) {
  e.preventDefault();
  const ta = box.querySelector('.st-form textarea'), text = ta.value.trim();
  if (!text) return;
  const f = folderById(fid), it = studyFlows(fid).find((x) => x.id === fid).steps[sel];
  f.rnotes = [...(f.rnotes || []), { id: uid(), step: it.id, kind, text, ...(it.flowT != null ? { t: it.flowT } : {}) }];
  if (!f.study) f.study = { id: uid(), resp: f.name };
  saveIndex(); sfx('done'); draw();
  const n = box.querySelector('.st-form textarea'); if (n) n.focus();
}

async function saveMd(md, name) {
  name = name.replace(/[\\/:*?"<>|]+/g, '_');
  if (!window.__TAURI_INTERNALS__) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: name, filters: [{ name: 'Markdown', extensions: ['md'] }] });
  if (!path) return;
  try { await (await import('@tauri-apps/plugin-fs')).writeTextFile(path, md); toast('Отчёт сохранён'); } catch (err) { toast('Не удалось сохранить отчёт: ' + ((err && err.message) || err)); }
}
export function unmountStudy() { box = null; }
