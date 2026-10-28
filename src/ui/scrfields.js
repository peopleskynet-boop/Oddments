// «Экран приложения» in the properties panel: which app, platform, kind of screen, patterns, date and version of a
// screenshot (lib/screens.js). Guesses from the text and the picture come as ✦ chips — a click takes one. For several
// selected screens the fields set all of them at once (a whole recording of one app in one go).
// Stored in the optional field `scr` of each item; an emptied field is removed, an empty `scr` too.
import { S } from '../state.js';
import { esc } from '../util.js';
import { ic } from './icons.js';
import { saveIndex } from '../lib/library.js';
import { APPS, TYPES, PATTERNS, OSES, guessScreen } from '../lib/screens.js';
import { readPref, writePref } from '../lib/prefs.js';

const PREF = 'perch.scrOpen';
let open = readPref(PREF, { on: false }).on;

// a screen is a picture: phone screenshots (tall) show the block open by itself; any picture can be marked one
const pictureLike = (it) => (it.kind === 'image' || it.kind === 'psd') && !it.trashed;
export const isScreenish = (it) => pictureLike(it) && (it.scr || it.ar >= 1.6 || /(^|\n)\s*9:41\b/.test(it.ocr || ''));

const same = (items, f) => { const v = items.map(f); return v.every((x) => x === v[0]) ? v[0] : null; };

let force = null; // «Это экран приложения…» pressed on a picture that does not look like one

export function scrBlock(items) {
  items = items.filter(pictureLike);
  if (!items.length) return '';
  const one = items.length === 1 ? items[0] : null;
  // an illustration, an icon, a photo: one quiet link instead of six empty fields
  if (one && !isScreenish(one) && force !== one.id) return `<button class="lnk scr-mark" data-scrmark="${esc(one.id)}">Это экран приложения…</button>`;
  const scr = (it) => it.scr || {};
  const g = one ? guessScreen(one) : {};
  // a colour alone says nothing about a picture that is not a screenshot
  if (one && !isScreenish(one)) for (const k of Object.keys(g)) if (!g[k].sure) delete g[k];
  const app = same(items, (i) => scr(i).app || ''), type = same(items, (i) => scr(i).type || ''), os = same(items, (i) => scr(i).os || '');
  const date = one ? (scr(one).date || '') : same(items, (i) => scr(i).date || '') || '', ver = one ? (scr(one).ver || '') : same(items, (i) => scr(i).ver || '') || '';
  const pats = one ? scr(one).pat || [] : PATTERNS.filter((p) => items.every((i) => (scr(i).pat || []).includes(p)));
  const sug = (k, v) => (v && !(one && scr(one)[k]) ? `<button class="scr-sug${v.sure ? '' : ' maybe'}" data-scrok="${k}" data-v="${esc(v.value)}" title="${v.sure ? 'Найдено по тексту на экране' : 'Догадка по размеру или цветам'} — нажмите, чтобы взять">✦ ${esc(k === 'os' ? (OSES.find(([x]) => x === v.value) || [, v.value])[1] : v.value)}${v.sure ? '' : '?'}</button>` : '');
  const summary = one && one.scr ? [scr(one).app, (OSES.find(([k]) => k === scr(one).os) || [])[1], scr(one).type].filter(Boolean).join(' · ') : '';
  const isOpen = open || (one && isScreenish(one) && !one.scr) || !one;
  const hist = one && one.scr && one.scr.app && one.scr.type ? S.items.filter((x) => x !== one && !x.trashed && x.scr && x.scr.app === one.scr.app && x.scr.type === one.scr.type).length : 0;
  return `<details class="scr-blk"${isOpen ? ' open' : ''}><summary><span>Экран приложения</span>${summary ? `<em>${esc(summary)}</em>` : ''}</summary>` +
    `<div class="scr-f"><label class="scr-l">Приложение</label><div class="scr-v"><input type="text" data-scr="app" list="scrApps" value="${esc(app === null ? '' : app)}" placeholder="${app === null ? 'разное' : 'Т-Банк, Сбер…'}" autocomplete="off">${sug('app', g.app)}</div>` +
    `<label class="scr-l">Платформа</label><div class="scr-v"><span class="scr-seg" role="group" aria-label="Платформа">${OSES.map(([k, n]) => `<button type="button" data-scros="${k}" aria-pressed="${os === k}">${n}</button>`).join('')}</span>${sug('os', g.os)}</div>` +
    `<label class="scr-l">Тип экрана</label><div class="scr-v"><input type="text" data-scr="type" list="scrTypes" value="${esc(type === null ? '' : type)}" placeholder="${type === null ? 'разное' : 'Перевод, онбординг…'}" autocomplete="off">${sug('type', g.type)}</div>` +
    `<label class="scr-l">Паттерны</label><div class="scr-v scr-pats">${pats.map((p) => `<span class="tag">${esc(p)}<button data-scrrm="${esc(p)}" aria-label="Убрать ${esc(p)}">${ic('x')}</button></span>`).join('')}` +
    `<input type="text" data-scr="pat" list="scrPats" placeholder="+ паттерн" autocomplete="off"></div>` +
    `<label class="scr-l">Дата</label><div class="scr-v"><input type="date" data-scr="date" value="${esc(date)}"></div>` +
    `<label class="scr-l">Версия</label><div class="scr-v"><input type="text" data-scr="ver" value="${esc(ver)}" placeholder="напр. 7.42" autocomplete="off"></div></div>` +
    (hist ? `<button class="lnk" data-act="scrhist">Как менялся этот экран · ${hist + 1}</button>` : '') +
    `<button class="lnk" data-act="screens">Все экраны →</button>` +
    `<datalist id="scrApps">${APPS.map((a) => `<option value="${esc(a.name)}">`).join('')}${[...new Set(S.items.map((i) => i.scr && i.scr.app).filter(Boolean))].filter((n) => !APPS.some((a) => a.name === n)).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>` +
    `<datalist id="scrTypes">${TYPES.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>` +
    `<datalist id="scrPats">${PATTERNS.filter((p) => !pats.includes(p)).map((p) => `<option value="${esc(p)}">`).join('')}</datalist></details>`;
}

// set a field on every selected picture; '' removes it
function setAll(items, k, v) {
  for (const it of items) {
    const s = { ...(it.scr || {}) };
    if (k === 'pat') { if (v) s.pat = [...new Set([...(s.pat || []), v])]; } else if (v) s[k] = v; else delete s[k];
    if (s.pat && !s.pat.length) delete s.pat;
    if (Object.keys(s).length) {
      // a screen gets its date the first time it is marked: when it was added (a screenshot is usually saved the day it is made)
      if (!s.date && k !== 'date' && it.added) s.date = new Date(it.added).toISOString().slice(0, 10);
      it.scr = s;
    } else delete it.scr;
  }
  saveIndex();
}

export function bindScr(insp, selItems, rerender) {
  const items = () => selItems().filter(pictureLike);
  insp.addEventListener('toggle', (e) => {
    if (!e.target.matches || !e.target.matches('.scr-blk')) return;
    open = e.target.open; writePref(PREF, { on: open });
  }, true);
  insp.addEventListener('change', (e) => {
    const t = e.target.closest && e.target.closest('[data-scr]');
    if (!t) return;
    const k = t.dataset.scr, v = t.value.trim();
    if (k === 'pat' && !v) return;
    setAll(items(), k, v);
    if (k === 'pat' || k === 'app' || k === 'type') rerender();
  });
  insp.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.scr === 'pat' && e.key === 'Enter' && t.value.trim()) { e.preventDefault(); setAll(items(), 'pat', t.value.trim()); rerender(); setTimeout(() => { const n = insp.querySelector('[data-scr="pat"]'); if (n) n.focus(); }); }
  });
  insp.addEventListener('click', (e) => {
    let b;
    if ((b = e.target.closest('[data-scrmark]'))) { force = b.dataset.scrmark; open = true; rerender(); }
    else if ((b = e.target.closest('[data-scrok]'))) { setAll(items(), b.dataset.scrok, b.dataset.v); rerender(); }
    else if ((b = e.target.closest('[data-scros]'))) { const its = items(), on = b.getAttribute('aria-pressed') === 'true'; setAll(its, 'os', on ? '' : b.dataset.scros); rerender(); }
    else if ((b = e.target.closest('[data-scrrm]'))) { for (const it of items()) if (it.scr && it.scr.pat) { it.scr.pat = it.scr.pat.filter((p) => p !== b.dataset.scrrm); if (!it.scr.pat.length) delete it.scr.pat; } saveIndex(); rerender(); }
    else if ((b = e.target.closest('[data-act="screens"]'))) import('./screens.js').then((m) => m.openScreens());
    else if ((b = e.target.closest('[data-act="scrhist"]'))) { const it = items()[0]; if (it) import('./screens.js').then((m) => m.openScreens({ history: it.id })); }
  });
}
