// «Экраны»: the library's app screens as a product designer looks for them — by app, platform, kind of screen and
// pattern (lib/screens.js, the `scr` field the properties panel sets). Four views:
//   Все экраны    — grouped by app and kind, filter chips;
//   Разметить     — pictures that look like screens but are not marked: the guesses from their text, size and colours,
//                   one click each or «Взять все уверенные»;
//   Как менялся   — one kind of screen of one app across dates and versions, side by side;
//   Сравнить      — two flows (screen recordings, flows.js) step by step, with their numbers: steps, time, waits, ways back.
import './screens.css';
import { pushLayer, popLayer } from './layers.js';
import { S, ui, folderById } from '../state.js';
import { esc, plural } from '../util.js';
import { ic } from './icons.js';
import { assetUrl, saveIndex } from '../lib/library.js';
import { sfx } from './sound.js';
import { toast } from './dialogs.js';
import { OSES, guessScreen, flowStats } from '../lib/screens.js';
import { isScreenish } from './scrfields.js';
import { readPref, writePref } from '../lib/prefs.js';

const PREF = 'perch.screens';
const st = readPref(PREF, { tab: 'all', apps: [], os: '', types: [], pats: [], a: '', b: '' });
let el = null, hist = null; // hist: { app, type } for «Как менялся»
export const isScreensOpen = () => !!(el && !el.hidden);
const keep = () => writePref(PREF, { ...st });

const screens = () => S.items.filter((i) => !i.trashed && i.scr);
const thumb = (it) => (it.thumb ? assetUrl(it.thumb) : '');
const osName = (k) => (OSES.find(([x]) => x === k) || [, ''])[1];
const card = (it, sub = '') => `<button type="button" class="scn-c" data-open="${esc(it.id)}" title="${esc(it.name)}"><img src="${esc(thumb(it))}" alt="" loading="lazy" decoding="async">${sub ? `<span class="scn-s">${sub}</span>` : ''}</button>`;
const count = (n, f) => `${n} ${plural(n, f)}`;

function build() {
  el = document.createElement('section');
  el.className = 'scn';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Экраны приложений');
  el.innerHTML = `<header class="scn-top"><div><h2 class="scn-t">Экраны</h2><span class="scn-sub cap-sm"></span></div>
      <div class="scn-seg" role="tablist" aria-label="Вид">${[['all', 'Все экраны'], ['mark', 'Разметить'], ['hist', 'Как менялся'], ['cmp', 'Сравнить сценарии']].map(([k, n]) => `<button type="button" role="tab" data-tab="${k}">${n}</button>`).join('')}</div>
      <button type="button" class="ib" data-sc="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></header>
    <div class="scn-body"></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('keydown', onKey);
}
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeScreens(); }
  e.stopPropagation(); // the wall's keys stay off
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.sc === 'close') closeScreens();
  else if (d.tab) { st.tab = d.tab; keep(); sfx('tick'); draw(); }
  else if (d.open) import('./preview.js').then((m) => m.openPreview(d.open));
  else if (d.fapp != null) { st.apps = toggle(st.apps, d.fapp); keep(); draw(); }
  else if (d.fos != null) { st.os = st.os === d.fos ? '' : d.fos; keep(); draw(); }
  else if (d.ftype != null) { st.types = toggle(st.types, d.ftype); keep(); draw(); }
  else if (d.fpat != null) { st.pats = toggle(st.pats, d.fpat); keep(); draw(); }
  else if (d.fclear) { st.apps = []; st.os = ''; st.types = []; st.pats = []; keep(); draw(); }
  else if (d.hist) { const [app, type] = JSON.parse(d.hist); hist = { app, type }; st.tab = 'hist'; keep(); draw(); }
  else if (d.take) { take(S.byId.get(d.take), d.k, d.v); draw(); }
  else if (d.takeall) takeAll();
}
function onChange(e) {
  const t = e.target;
  if (t.dataset.hsel) { const [app, type] = JSON.parse(t.value || '["",""]'); hist = app ? { app, type } : null; draw(); }
  else if (t.dataset.cmp) { st[t.dataset.cmp] = t.value; keep(); draw(); }
}
const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

/* ---------- marking: the guesses ---------- */
function take(it, k, v) {
  if (!it) return;
  const s = { ...(it.scr || {}) };
  s[k] = v;
  if (!s.date && it.added) s.date = new Date(it.added).toISOString().slice(0, 10);
  it.scr = s;
  saveIndex();
}
function takeAll() {
  let n = 0;
  for (const it of toMark()) {
    const g = guessScreen(it);
    let any = false;
    for (const k of ['app', 'os', 'type']) if (g[k] && g[k].sure && !(it.scr && it.scr[k])) { take(it, k, g[k].value); any = true; }
    if (any) n++;
  }
  sfx(n ? 'done' : 'tick');
  toast(n ? `Размечено по уверенным догадкам: ${count(n, ['экран', 'экрана', 'экранов'])}` : 'Уверенных догадок нет — отметьте вручную в панели свойств');
  draw();
}
const toMark = () => S.items.filter((i) => !i.trashed && isScreenish(i) && (!i.scr || !i.scr.app || !i.scr.type));

/* ---------- views ---------- */
function draw() {
  el.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab)));
  const all = screens();
  el.querySelector('.scn-sub').textContent = `${count(all.length, ['экран', 'экрана', 'экранов'])} · ${count(new Set(all.map((i) => i.scr.app).filter(Boolean)).size, ['приложение', 'приложения', 'приложений'])}`;
  const body = el.querySelector('.scn-body');
  body.innerHTML = st.tab === 'mark' ? markView() : st.tab === 'hist' ? histView() : st.tab === 'cmp' ? cmpView() : allView(all);
  body.scrollTop = 0;
}

function chips(label, list, on, attr, name = (x) => x) {
  if (!list.length) return '';
  return `<div class="scn-f"><span class="scn-fl">${label}</span>${list.map(([v, n]) => `<button type="button" class="scn-ch" data-${attr}="${esc(v)}" aria-pressed="${on(v)}">${esc(name(v))}<b>${n}</b></button>`).join('')}</div>`;
}
const tally = (items, f) => { const m = new Map(); for (const i of items) for (const v of [].concat(f(i) || [])) m.set(v, (m.get(v) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };

function allView(all) {
  if (!all.length) {
    const n = toMark().length;
    return `<div class="scn-empty"><h3>Экранов пока нет</h3><p>Отметьте у скриншота приложение и тип экрана — в панели свойств, блок «Экран приложения». ${n ? `Похожих на экраны картинок без отметки: ${n} — их можно разметить по догадкам.` : 'Сценарий из записи экрана тоже даёт экраны.'}</p>${n ? '<button type="button" class="ibtn pri" data-tab="mark">Разметить</button>' : ''}</div>`;
  }
  const vis = all.filter((i) => (!st.apps.length || st.apps.includes(i.scr.app)) && (!st.os || i.scr.os === st.os) && (!st.types.length || st.types.includes(i.scr.type)) && (!st.pats.length || st.pats.every((p) => (i.scr.pat || []).includes(p))));
  const filters = chips('Приложение', tally(all, (i) => i.scr.app), (v) => st.apps.includes(v), 'fapp') +
    chips('Платформа', tally(all, (i) => i.scr.os), (v) => st.os === v, 'fos', osName) +
    chips('Тип', tally(all, (i) => i.scr.type), (v) => st.types.includes(v), 'ftype') +
    chips('Паттерн', tally(all, (i) => i.scr.pat), (v) => st.pats.includes(v), 'fpat') +
    (st.apps.length || st.os || st.types.length || st.pats.length ? '<button type="button" class="lnk" data-fclear="1">Сбросить фильтры</button>' : '');
  // grouped: app, then kind of screen; newest first inside
  const groups = new Map();
  for (const it of vis.slice().sort((a, b) => (b.scr.date || '').localeCompare(a.scr.date || ''))) {
    const k = JSON.stringify([it.scr.app || '', it.scr.type || '']);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const rows = [...groups].sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([k, list]) => {
    const [app, type] = JSON.parse(k), dates = new Set(list.map((i) => i.scr.date).filter(Boolean));
    return `<section class="scn-g"><h3><span>${esc(app || 'Без приложения')}</span><em>${esc(type || 'тип не указан')}</em><b>${list.length}</b>` +
      (dates.size > 1 ? `<button type="button" class="lnk" data-hist="${esc(k)}">Как менялся</button>` : '') + `</h3>` +
      `<div class="scn-row">${list.map((it) => card(it, [osName(it.scr.os), it.scr.date && it.scr.date.slice(0, 7)].filter(Boolean).join(' · '))).join('')}</div></section>`;
  }).join('');
  return `<div class="scn-filters">${filters}</div>${rows || '<p class="scn-p">Под эти фильтры экранов нет.</p>'}`;
}

function markView() {
  const list = toMark();
  if (!list.length) return '<div class="scn-empty"><h3>Всё размечено</h3><p>Картинок, похожих на экраны приложений, без отметки нет.</p></div>';
  const sure = list.filter((it) => { const g = guessScreen(it); return ['app', 'os', 'type'].some((k) => g[k] && g[k].sure && !(it.scr && it.scr[k])); }).length;
  const rows = list.slice(0, 200).map((it) => {
    const g = guessScreen(it);
    const sug = ['app', 'os', 'type'].map((k) => {
      if (it.scr && it.scr[k]) return `<span class="scn-have">${esc(k === 'os' ? osName(it.scr[k]) : it.scr[k])}</span>`;
      if (!g[k]) return '';
      return `<button type="button" class="scr-sug${g[k].sure ? '' : ' maybe'}" data-take="${esc(it.id)}" data-k="${k}" data-v="${esc(g[k].value)}">✦ ${esc(k === 'os' ? osName(g[k].value) : g[k].value)}${g[k].sure ? '' : '?'}</button>`;
    }).join('');
    return `<div class="scn-m">${card(it)}<div class="scn-mi"><span class="scn-mn">${esc(it.name)}</span><div class="scn-sugs">${sug || '<span class="scn-p">Догадок нет — отметьте в панели свойств</span>'}</div></div></div>`;
  }).join('');
  return `<div class="scn-bar"><p class="scn-p">Похоже на экраны приложений: ${list.length}. Догадки — по тексту на экране (уверенные), размеру и фирменным цветам (с «?»).</p>` +
    (sure ? `<button type="button" class="ibtn pri" data-takeall="1">Взять все уверенные (${sure})</button>` : '') + `</div><div class="scn-mark">${rows}</div>` +
    (list.length > 200 ? `<p class="scn-p">Показаны первые 200 из ${list.length}.</p>` : '');
}

function histView() {
  const pairs = tally(screens(), (i) => (i.scr.app && i.scr.type ? JSON.stringify([i.scr.app, i.scr.type]) : null)).filter(([, n]) => n > 1);
  if (!hist && pairs.length) { const [app, type] = JSON.parse(pairs[0][0]); hist = { app, type }; }
  const sel = `<select class="scn-sel" data-hsel="1" aria-label="Экран">${pairs.map(([k, n]) => { const [a, t] = JSON.parse(k); return `<option value="${esc(k)}"${hist && hist.app === a && hist.type === t ? ' selected' : ''}>${esc(a)} · ${esc(t)} (${n})</option>`; }).join('')}</select>`;
  if (!hist) return '<div class="scn-empty"><h3>Нечего сравнивать</h3><p>Нужны два экрана одного типа одного приложения — например «Т-Банк · Перевод» за разные месяцы.</p></div>';
  const list = screens().filter((i) => i.scr.app === hist.app && i.scr.type === hist.type).sort((a, b) => (a.scr.date || '').localeCompare(b.scr.date || ''));
  return `<div class="scn-bar">${sel}<p class="scn-p">${esc(hist.app)} · ${esc(hist.type)}: ${count(list.length, ['экран', 'экрана', 'экранов'])}, по дате — слева старые.</p></div>` +
    `<div class="scn-hist">${list.map((it) => `<figure>${card(it)}<figcaption><b>${esc(it.scr.date || 'без даты')}</b>${it.scr.ver ? ` · v${esc(it.scr.ver)}` : ''}${it.scr.os ? ` · ${osName(it.scr.os)}` : ''}</figcaption></figure>`).join('')}</div>`;
}

function cmpView() {
  const flows = S.folders.filter((f) => f.flow && (f.order || []).length);
  if (flows.length < 2) return '<div class="scn-empty"><h3>Нужно два сценария</h3><p>Сценарий получается из записи экрана: «Добавить › Сценарий из записи экрана…». Запишите один и тот же путь у себя и у конкурента — здесь они встанут рядом по шагам.</p></div>';
  if (!flows.some((f) => f.id === st.a)) st.a = flows[0].id;
  if (!flows.some((f) => f.id === st.b) || st.b === st.a) st.b = (flows.find((f) => f.id !== st.a) || flows[1]).id;
  const opt = (sel) => flows.map((f) => `<option value="${esc(f.id)}"${f.id === sel ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
  const steps = (fid) => (folderById(fid).order || []).map((id) => S.byId.get(id)).filter((i) => i && !i.trashed);
  const A = steps(st.a), B = steps(st.b), sa = flowStats(A), sb = flowStats(B);
  const fmt = (s) => (s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toLocaleString('ru-RU')} с`);
  const stat = (s) => `<span><b>${s.steps}</b> ${plural(s.steps, ['шаг', 'шага', 'шагов'])}</span><span><b>${fmt(s.seconds)}</b> по записи</span><span><b>${s.waits}</b> ${plural(s.waits, ['ожидание', 'ожидания', 'ожиданий'])}${s.waitSeconds ? ` · ${fmt(s.waitSeconds)}` : ''}</span><span><b>${s.backs}</b> ${plural(s.backs, ['возврат', 'возврата', 'возвратов'])} назад</span>`;
  // each sentence names its flow: the shorter one need not be the faster one
  const nm = (id) => `«${folderById(id).name}»`, diff = [];
  if (sa.steps !== sb.steps) diff.push(`${nm(sa.steps < sb.steps ? st.a : st.b)} короче на ${count(Math.abs(sa.steps - sb.steps), ['шаг', 'шага', 'шагов'])}`);
  if (sa.seconds != null && sb.seconds != null && Math.abs(sa.seconds - sb.seconds) >= 2) diff.push(`${nm(sa.seconds < sb.seconds ? st.a : st.b)} проходится быстрее на ${fmt(Math.round(Math.abs(sa.seconds - sb.seconds)))}`);
  if (sa.backs !== sb.backs) diff.push(`в ${nm(sa.backs > sb.backs ? st.a : st.b)} возвращались назад чаще`);
  const n = Math.max(A.length, B.length);
  const col = (list, i) => (list[i] ? card(list[i], `${String(i + 1).padStart(2, '0')}${list[i].flowSig && list[i].flowSig.some((x) => x.k === 'wait') ? ' · ждали' : ''}${list[i].flowSig && list[i].flowSig.some((x) => x.k === 'back') ? ' · назад' : ''}`) : '<span class="scn-none"></span>');
  return `<div class="scn-cmp-h"><label><select class="scn-sel" data-cmp="a" aria-label="Первый сценарий">${opt(st.a)}</select><div class="scn-st">${stat(sa)}</div></label>` +
    `<label><select class="scn-sel" data-cmp="b" aria-label="Второй сценарий">${opt(st.b)}</select><div class="scn-st">${stat(sb)}</div></label></div>` +
    (diff.length ? `<p class="scn-diff">${esc(diff.join('. '))}.</p>` : '') +
    `<div class="scn-cmp">${Array.from({ length: n }, (_, i) => `<div class="scn-pair">${col(A, i)}${col(B, i)}</div>`).join('')}</div>`;
}

/* ---------- open / close ---------- */
export function openScreens(opts = {}) {
  if (!el) build();
  if (opts.history) {
    const it = S.byId.get(opts.history);
    if (it && it.scr) { hist = { app: it.scr.app, type: it.scr.type }; st.tab = 'hist'; }
  } else if (opts.tab) st.tab = opts.tab;
  el.hidden = false;
  pushLayer({ el, title: 'Экраны', close: closeScreens, onKey });
  sfx('open');
  draw();
  el.querySelector(`[data-tab="${st.tab}"]`).focus({ preventScroll: true });
}
export function closeScreens() {
  if (!isScreensOpen()) return;
  el.hidden = true;
  popLayer(el);
  el.querySelector('.scn-body').innerHTML = ''; // the thumbnails go with it (#125)
  sfx('close');
  ui.refresh && ui.renderInsp && ui.renderInsp();
}
