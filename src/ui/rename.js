// Batch rename of the selected files by a template: {name} {n} {date} {ext}, with a live preview before
// anything changes and «Отменить» afterwards. Only the name shown in Oddments changes (`it.name`, like renaming
// in the inspector) — the original files on disk are never touched.
import './rename.css';
import { S, ui } from '../state.js';
import { esc, plural } from '../util.js';
import { saveIndex } from '../lib/library.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';

const TOKENS = [
  ['{name}', 'текущее имя'],
  ['{n}', 'номер по порядку; {n:3} — 001'],
  ['{date}', 'дата добавления'],
  ['{ext}', 'расширение'],
];
const KEY = 'perch.renameTpl';
let el = null, items = [], back = null;

export const isRenameOpen = () => !!(el && el.classList.contains('on'));

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

// the new names for the items, in their order on screen
export function applyTemplate(tpl, list, start = 1) {
  const width = String(start + list.length - 1).length;
  return list.map((it, i) => tpl
    .replace(/\{n(?::(\d))?\}/g, (_, d) => String(start + i).padStart(d ? +d : (list.length > 9 ? width : 1), '0'))
    .replace(/\{name\}/g, it.name)
    .replace(/\{date\}/g, ymd(it.added))
    .replace(/\{ext\}/g, it.ext || '')
    .replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200));
}

export function openRename(list) {
  list = (list || []).filter((it) => it && !it.trashed);
  if (!list.length) return;
  // keep the order the files have on screen
  const pos = new Map(S.vis.map((x, i) => [x.id, i]));
  items = list.slice().sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  back = document.activeElement;
  if (!el) build();
  let tpl = '';
  try { tpl = localStorage.getItem(KEY) || ''; } catch (e) { /* ignore */ }
  el.querySelector('#rnT').textContent = `Переименовать ${items.length} ${plural(items.length, ['файл', 'файла', 'файлов'])}`;
  const inp = el.querySelector('#rnTpl');
  inp.value = tpl || (items.length > 1 ? '{name} {n}' : '{name}');
  el.querySelector('#rnStart').value = 1;
  el.classList.add('on');
  preview();
  inp.focus(); inp.select();
}

export function closeRename() {
  if (!isRenameOpen()) return;
  el.classList.remove('on');
  if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
  back = null; items = [];
}

function build() {
  el = document.createElement('div');
  el.className = 'modal rn';
  el.innerHTML = `<form class="dlg rn-dlg" role="dialog" aria-modal="true" aria-labelledby="rnT">
    <h2 id="rnT"></h2>
    <label class="rn-l" for="rnTpl">Шаблон</label>
    <input id="rnTpl" type="text" autocomplete="off" spellcheck="false" aria-describedby="rnHelp">
    <div class="rn-tok" id="rnHelp">${TOKENS.map(([t, d]) => `<button type="button" class="rn-t" data-t="${t}" title="${esc(d)}"><code>${t}</code><span>${esc(d)}</span></button>`).join('')}</div>
    <div class="rn-row"><label for="rnStart">Нумерация с</label><input id="rnStart" type="number" min="0" max="99999" value="1"></div>
    <div class="rn-pv" aria-live="polite"><div class="rn-pv-h"><span>Было</span><span>Станет</span></div><ol id="rnList"></ol></div>
    <p class="rn-note">Меняется только имя в Oddments, файлы на диске остаются как были.</p>
    <div class="row"><button type="button" class="ibtn" data-rn="cancel">Отмена</button><button type="submit" class="ibtn pri" id="rnGo">Переименовать</button></div>
  </form>`;
  document.body.appendChild(el);
  const form = el.querySelector('form'), inp = el.querySelector('#rnTpl');
  inp.addEventListener('input', preview);
  el.querySelector('#rnStart').addEventListener('input', preview);
  el.querySelector('.rn-tok').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    // insert the token where the caret is
    const s = inp.selectionStart ?? inp.value.length, f = inp.selectionEnd ?? s, t = b.dataset.t;
    inp.value = inp.value.slice(0, s) + t + inp.value.slice(f);
    inp.focus(); inp.setSelectionRange(s + t.length, s + t.length);
    preview();
  });
  el.querySelector('[data-rn="cancel"]').addEventListener('click', closeRename);
  el.addEventListener('pointerdown', (e) => { if (e.target === el) closeRename(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  el.addEventListener('keydown', (e) => {
    e.stopPropagation(); // the grid's shortcuts stay off while the dialog is open
    if (e.key === 'Escape') { e.preventDefault(); closeRename(); }
    else if (e.key === 'Tab') trap(e);
  });
}

function trap(e) {
  const f = Array.from(el.querySelectorAll('button:not([disabled]), input')).filter((x) => x.getClientRects().length);
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
}

function names() {
  const start = Math.max(0, parseInt(el.querySelector('#rnStart').value, 10) || 0);
  return applyTemplate(el.querySelector('#rnTpl').value, items, start);
}

function preview() {
  const next = names();
  const empty = next.filter((n) => !n).length, same = next.filter((n, i) => n === items[i].name).length;
  const MAX = 200;
  el.querySelector('#rnList').innerHTML = items.slice(0, MAX).map((it, i) => {
    const ext = it.ext ? `<i>.${esc(it.ext)}</i>` : '';
    const cls = !next[i] ? ' bad' : next[i] === it.name ? ' same' : '';
    return `<li class="${cls.trim()}"><span title="${esc(it.name)}">${esc(it.name)}${ext}</span><span title="${esc(next[i])}">${next[i] ? esc(next[i]) + ext : 'пустое имя'}</span></li>`;
  }).join('') + (items.length > MAX ? `<li class="more">и ещё ${items.length - MAX}</li>` : '');
  const go = el.querySelector('#rnGo');
  go.disabled = !!empty || same === items.length;
  go.textContent = empty ? 'Есть пустые имена' : same === items.length ? 'Имена не меняются' : 'Переименовать';
}

function apply() {
  const next = names();
  if (next.some((n) => !n)) return;
  const before = items.map((it) => [it, it.name]);
  items.forEach((it, i) => { it.name = next[i]; });
  try { localStorage.setItem(KEY, el.querySelector('#rnTpl').value); } catch (e) { /* ignore */ }
  const n = before.filter(([it, old]) => it.name !== old).length;
  saveIndex();
  closeRename();
  ui.refresh();
  sfx('done');
  toast(`Переименовано: ${n}`, 0, { fn: () => { before.forEach(([it, old]) => { it.name = old; }); saveIndex(); ui.refresh(); } });
}
