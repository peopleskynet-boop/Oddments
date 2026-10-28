// «Новости»: the daily digest (lib/digest.js), saved articles and a reader (lib/news.js). One screen with two tabs
// and the reader on top of them; the reels feed (feed.js) is its third door. The reader: the article's own text
// in calm reading type, its pictures (hover — «В Oddments»), translate to Russian (Claude), open the original, delete.
import { lang } from '../lib/i18n.js';
import './news.css';
import { pushLayer, popLayer } from './layers.js';
import { esc, plural } from '../util.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { pixLoader } from './pixload.js';
import { ui } from '../state.js';
import * as N from '../lib/news.js';
import * as D from '../lib/digest.js';
import { hydrate } from '../lib/remote.js';
// remote pictures go through remote.js (the exe's CSP blocks them as plain src): an article's own <img src> → data-src
const deferImgs = (html) => html.replace(/<img\b([^>]*?)\ssrc=/gi, '<img$1 data-src=');

let el = null, body = null, tab = 'digest', reading = null, busy = false;
const dateFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' });
const dayTitle = (key) => { const [y, m, d] = key.split('-').map(Number); const t = new Date(y, m - 1, d); return key === D.today() ? 'Сегодня, ' + dateFmt.format(t) : dateFmt.format(t); };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

export const isNewsOpen = () => !!(el && !el.hidden);

function build() {
  el = document.createElement('section');
  el.className = 'news';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Новости');
  el.innerHTML = `<header class="nw-top">
      <button type="button" class="ib glass nw-back" data-nw="back" aria-label="Назад к списку" title="Назад (Esc)" hidden>${ic('back')}</button>
      <div class="nw-tabs glass" role="tablist" aria-label="Разделы новостей">
        <button type="button" role="tab" data-tab="digest">${ic('sparkle')}Сводка дня</button>
        <button type="button" role="tab" data-tab="saved">${ic('bookmark')}Сохранённое</button>
        <button type="button" role="tab" data-tab="feed">${ic('play')}Лента</button>
      </div>
      <button type="button" class="ib glass nw-x" data-nw="close" aria-label="Закрыть новости" title="Закрыть">${ic('x')}</button>
    </header>
    <div class="nw-body" tabindex="-1"></div>`;
  document.body.appendChild(el);
  body = el.querySelector('.nw-body');
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (reading) closeReader(); else closeNews(); }
    else e.stopPropagation(); // the grid's shortcuts stay off here
  };
  el.addEventListener('keydown', onKey); // keys that fell out onto the page body come through layers.js (bug #126)
  newsKey = onKey;
  // pictures in the reader: a «В Oddments» button on hover
  body.addEventListener('mouseover', (e) => {
    const img = e.target.closest && e.target.closest('.nw-article img');
    if (!img || img.parentElement.classList.contains('nw-pic')) return;
    const wrap = document.createElement('span');
    wrap.className = 'nw-pic';
    img.replaceWith(wrap);
    wrap.append(img);
    wrap.insertAdjacentHTML('beforeend', `<button type="button" class="nw-pic-b" data-nw="pic">${ic('download')}В Oddments</button>`);
  });
}

/* ---------- tabs ---------- */
function setTab(t) {
  if (t === 'feed') { closeNews(); import('./feed.js').then((m) => m.openFeed()); return; }
  tab = t;
  reading = null;
  fromFeed = false;
  el.querySelector('.nw-back').hidden = true;
  el.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  if (tab === 'digest') showDigest(); else showSaved();
  body.scrollTop = 0;
}

/* ---------- the digest ---------- */
async function showDigest(key) {
  const days = await D.digestDays();
  const d = await D.loadDigest(key || days[0] || D.today());
  const prefs = D.digestPrefs();
  const auto = `<label class="nw-auto"><input type="checkbox" data-nw="auto"${prefs.auto ? ' checked' : ''}> Собирать каждое утро</label>`;
  const daysRow = days.length > 1 ? `<div class="nw-days">${days.slice(0, 10).map((k) => `<button type="button" data-day="${k}" aria-pressed="${d && d.day === k}">${esc(dayTitle(k).replace('Сегодня, ', ''))}</button>`).join('')}</div>` : '';
  if (!d) {
    body.innerHTML = `<div class="nw-col"><div class="nw-hero"><h1>Сводка дня</h1>
      <p>Главное за сутки в ИИ и в дизайне — не всё подряд, а заметное: о чём пишут сразу несколько изданий, что в топе Denis Trends и Hugging Face, что упомянули редакторы TLDR AI и The Rundown, какой пост в канале набрал больше просмотров, чем обычно.</p>
      ${modeNote(null)}
      <div class="nw-acts"><button type="button" class="pill pri" data-nw="make">${ic('sparkle')}Собрать сводку</button>${auto}</div></div>${daysRow}</div>`;
    return;
  }
  const story = (s, i) => `<article class="nw-story">
      ${s.image ? `<img data-src="${esc(s.image)}" alt="" referrerpolicy="no-referrer">` : ''}
      <div><h3>${esc(s.title)}</h3>${s.summary ? `<p>${esc(s.summary)}</p>` : ''}
      <div class="nw-meta">${s.why ? `<span class="nw-why">${esc(s.why)}</span>` : ''}${s.links.map((l) => `<a href="${esc(l.url)}" data-nw="ext" title="${esc(l.title)}">${esc(l.site)}</a>`).join('')}</div>
      <div class="nw-acts sm"><button type="button" class="pill" data-nw="read" data-url="${esc(s.links[0].url)}" data-i="${i}">${ic('article')}Читать здесь</button></div></div>
    </article>`;
  let n = 0;
  body.innerHTML = `<div class="nw-col"><div class="nw-hero"><h1>Сводка · ${esc(dayTitle(d.day))}</h1>
      ${modeNote(d)}
      <p class="nw-sub">${d.sources} ${plural(d.sources, ['источник', 'источника', 'источников'])}${d.failed.length ? ` · не ответили: ${d.failed.length}` : ''}</p>
      <div class="nw-acts"><button type="button" class="pill" data-nw="make">${ic('restore')}Собрать заново</button>${auto}</div></div>${daysRow}
    ${d.sections.map((sec) => `<section class="nw-sec"><h2>${esc(sec.title)}</h2>${sec.stories.length ? sec.stories.map((s) => story(s, n++)).join('') : '<p class="nw-sub">Ничего заметного за сутки.</p>'}</section>`).join('')}</div>`;
  hydrate(body);
  current = d;
}
let current = null;
// which digest it is, said plainly (bug #55: a digest without the key looked like the AI one and surprised the user)
function modeNote(d) {
  const key = !!(window.localStorage && (() => { try { return JSON.parse(localStorage.getItem('perch.iconai') || '{}').key; } catch (e) { return ''; } })());
  if (d && d.by === 'claude') return `<p class="nw-mode ai">${ic('sparkle')}<span>Отобрал и пересказал по-русски Claude</span></p>`;
  if (d || !key) return `<p class="nw-mode">${ic('info')}<span>${d ? 'Без ИИ: подборка по популярности, тексты на языке источников.' : 'Будет без ИИ: подборка по популярности, тексты на языке источников.'}</span>${key ? '' : '<button type="button" class="pill" data-nw="key">' + ic('sparkle') + 'Подключить ИИ — пересказ по-русски</button>'}</p>`;
  return `<p class="nw-mode ai">${ic('sparkle')}<span>Будет с ИИ: Claude отберёт главное и перескажет по-русски (один запрос, около $0,05)</span></p>`;
}

async function make() {
  if (busy) return;
  busy = true;
  const live = pixLoader('Собираю сводку…');
  body.innerHTML = '<div class="nw-col nw-wait"></div>';
  body.firstChild.appendChild(live.el);
  try { await D.makeDigest((t) => live.set(t)); sfx('done'); } catch (e) { toast('Сводка не собралась: ' + e.message, 7000); }
  live.stop();
  busy = false;
  if (isNewsOpen() && tab === 'digest' && !reading) showDigest();
}

/* ---------- saved articles ---------- */
async function showSaved() {
  const list = await N.articles();
  const form = `<form class="nw-add" data-nw="add"><input type="url" name="url" placeholder="Вставьте ссылку на статью" aria-label="Ссылка на статью" required><button type="submit" class="pill pri">${ic('bookmark')}Сохранить</button></form>`;
  body.innerHTML = `<div class="nw-col"><div class="nw-hero"><h1>Сохранённое</h1><p class="nw-sub">${list.length ? `${list.length} ${list.length % 10 === 1 && list.length % 100 !== 11 ? 'статья' : list.length % 10 >= 2 && list.length % 10 <= 4 && (list.length % 100 < 10 || list.length % 100 >= 20) ? 'статьи' : 'статей'} · читаются здесь, без рекламы и без интернета` : 'Статьи из ленты и сводки (кнопка «Сохранить статью») и любые по ссылке — читаются здесь, без рекламы и без интернета.'}</p>${form}</div>
    <div class="nw-list">${list.map((a) => `<button type="button" class="nw-card${a.read ? ' read' : ''}" data-open="${a.id}">
      ${a.image ? `<img data-src="${esc(a.image)}" alt="" referrerpolicy="no-referrer">` : `<span class="nw-noimg">${ic('article')}</span>`}
      <span class="nw-c"><b>${esc(a.title)}</b><small>${esc(a.site)} · ${a.minutes} мин${a.partial ? ' · только начало' : ''}</small>${a.excerpt ? `<span>${esc(a.excerpt)}</span>` : ''}</span></button>`).join('')}</div></div>`;
  hydrate(body);
}
async function addUrl(url, hint) {
  if (!/^https?:\/\//i.test(url)) { toast('Нужна ссылка вида https://…'); return null; }
  toast('Сохраняю статью…', 2000);
  try {
    const a = await N.saveArticle(url, hint);
    sfx('add');
    return a;
  } catch (e) { toast('Статья не сохранилась: ' + e.message, 7000); return null; }
}

/* ---------- the reader ---------- */
async function openReader(id) {
  const list = await N.articles();
  const a = list.find((x) => x.id === id);
  if (!a) return;
  const b = await N.articleBody(id);
  reading = a;
  el.querySelector('.nw-back').hidden = false;
  const pub = a.published ? ' · ' + dateFmt.format(new Date(a.published)) : '';
  body.innerHTML = `<article class="nw-col nw-read" lang="${b.ru ? 'ru' : ''}">
      <p class="nw-site">${esc(a.site)}${pub} · ${a.minutes} мин</p>
      <h1>${esc(b.ru ? b.ruTitle : a.title)}</h1>
      ${a.byline ? `<p class="nw-by">${esc(a.byline)}</p>` : ''}
      <div class="nw-acts"><button type="button" class="pill" data-nw="tr">${ic('sparkle')}${b.ru ? 'Оригинал' : 'Перевести'}</button><button type="button" class="pill" data-nw="orig">${ic('external')}Оригинал на сайте</button><button type="button" class="pill danger" data-nw="del">${ic('trash')}Удалить</button></div>
      ${a.paywall ? `<p class="nw-note">Статья для подписчиков ${esc(a.site)}: сайт отдал только начало. Если у вас есть подписка, откройте статью в браузере и сохраните её расширением Oddments (правый клик › Oddments › «Сохранить статью в Oddments») — сохранится целиком.</p>` : a.partial ? '<p class="nw-note">Сайт не отдал статью целиком: здесь начало, полный текст — по кнопке «Оригинал на сайте».</p>' : ''}
      <div class="nw-article">${deferImgs(b.ru ? b.ruHtml : b.html)}</div></article>`;
  hydrate(body);
  body.scrollTop = 0;
  body.focus({ preventScroll: true });
  if (!a.read) N.updateArticle(id, { read: true });
}
function closeReader() {
  // opened from the feed: «Назад» goes back to the same card in the feed (bug #52)
  if (fromFeed) { fromFeed = false; reading = null; closeNews(true); import('./feed.js').then((m) => m.openFeed(true)); return; }
  reading = null;
  el.querySelector('.nw-back').hidden = true;
  if (tab === 'digest') showDigest(current && current.day); else showSaved();
}

// the translation: the text blocks of the article in order, put back into the same markup; kept with the article
async function translate(btn) {
  const a = reading;
  const b = await N.articleBody(a.id);
  // ru: which one is shown; the translation is made once and kept next to the original
  if (b.ruHtml) { await N.saveBody(a.id, { ...b, ru: !b.ru }); openReader(a.id); return; }
  const d = new DOMParser().parseFromString('<body>' + b.html + '</body>', 'text/html');
  const nodes = [...d.body.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, figcaption')].filter((n) => !n.querySelector('p, li') && n.textContent.trim());
  btn.disabled = true;
  try {
    const out = await N.translateBlocks([a.title, ...nodes.map((n) => n.textContent.trim())], (k, n) => { btn.lastChild.textContent = ` Перевожу ${Math.round(k / n * 100)}%`; });
    nodes.forEach((n, i) => { n.textContent = out[i + 1]; });
    await N.saveBody(a.id, { html: b.html, ruHtml: d.body.innerHTML, ruTitle: out[0], ru: true });
    openReader(a.id);
  } catch (e) { toast('Перевод не получился: ' + e.message, 7000); btn.disabled = false; btn.lastChild.textContent = 'Перевести'; }
}

/* ---------- events ---------- */
async function onClick(e) {
  const t = e.target.closest('[data-tab]');
  if (t) { setTab(t.dataset.tab); return; }
  const day = e.target.closest('[data-day]');
  if (day) { showDigest(day.dataset.day); return; }
  const card = e.target.closest('[data-open]');
  if (card) { openReader(card.dataset.open); return; }
  const openUrl = (u) => import('@tauri-apps/plugin-opener').then((m) => m.openUrl(u)).catch(() => window.open(u, '_blank'));
  const b = e.target.closest('[data-nw]');
  // links inside an article open in the browser, not in Oddments' window
  const link = !b && e.target.closest('.nw-article a[href]');
  if (link) { e.preventDefault(); openUrl(link.href); return; }
  if (!b) return;
  const a = b.dataset.nw;
  if (a === 'close') closeNews();
  else if (a === 'back') closeReader();
  else if (a === 'make') make();
  else if (a === 'key') { closeNews(); import('./settings.js').then((m) => m.openSettings && m.openSettings('sIaKey')); }
  else if (a === 'auto') { D.setDigestPrefs({ auto: b.checked }); if (b.checked) scheduleDigest(); }
  else if (a === 'ext') { e.preventDefault(); openUrl(b.href); }
  else if (a === 'read') {
    const s = current && current.sections.flatMap((x) => x.stories)[+b.dataset.i];
    b.disabled = true;
    const art = await addUrl(b.dataset.url, s ? { title: s.title, text: s.summary, image: s.image, site: s.links[0].site } : {});
    b.disabled = false;
    if (art) openReader(art.id);
  } else if (a === 'orig' && reading) openUrl(reading.url);
  else if (a === 'tr' && reading) translate(b);
  else if (a === 'del' && reading) { const id = reading.id; await N.removeArticle(id); toast('Статья удалена'); tab = 'saved'; setTab('saved'); }
  else if (a === 'pic') {
    const img = b.parentElement.querySelector('img');
    try {
      const { fetchImage } = await import('../lib/clipboard.js');
      const got = await fetchImage(img.dataset.src || img.src); // the original address, not the app's blob: copy
      await ui.addBlobs([{ blob: got.blob, name: (reading ? reading.title.slice(0, 80) : 'Статья') + ((got.name.match(/\.[a-z0-9]{2,5}$/i) || ['.jpg'])[0]), source: reading ? reading.url : img.src }]);
    } catch (err) { toast('Картинка не сохранилась: ' + ((err && err.message) || err)); }
  }
}
async function onSubmit(e) {
  if (!e.target.matches('[data-nw="add"]')) return;
  e.preventDefault();
  const inp = e.target.querySelector('input');
  const art = await addUrl(inp.value.trim());
  if (art) { inp.value = ''; showSaved(); }
}

let fromFeed = false, newsKey = null;
export async function openNews(which = 'digest') {
  if (!el) build();
  el.hidden = false;
  el.classList.remove('leaving');
  document.body.classList.add('news-on');
  pushLayer({ el, title: 'Новости', close: () => closeNews(), onKey: newsKey });
  sfx('open');
  setTab(which);
  requestAnimationFrame(() => body.focus({ preventScroll: true }));
}
export function closeNews(quiet = false) {
  if (!isNewsOpen()) return;
  reading = null;
  document.body.classList.remove('news-on');
  popLayer(el);
  if (!quiet) sfx('close');
  import('./feed.js').then((m) => m.leave(el)); // fades out (bug #65)
}

// from the feed: «Читать» — the whole article right here, saved on the way; «Назад» returns to the same card (bug #52)
export async function readFromFeed(x) {
  const a = await addUrl(x.link, { title: x.title, text: x.text, image: x.image, site: x.sourceName, date: x.date });
  if (!a) return false;
  const feed = await import('./feed.js');
  feed.closeFeed(true);
  await openNews('saved');
  fromFeed = true;
  await openReader(a.id);
  return true;
}
// from the browser extension: the page as the person's browser shows it (a site they are logged in to gives the whole
// article — bug #67); saved and offered to read
export async function saveFromBrowser(html, url) {
  try {
    const a = await N.saveArticle(url, {}, html);
    sfx('add');
    toast(`Статья сохранена${a.paywall ? ' (только начало — сайт закрыл остальное)' : ''}: «${a.title.slice(0, 60)}»`, 0, { label: 'Читать', fn: () => openNews('saved').then(() => openReader(a.id)) });
    if (isNewsOpen() && tab === 'saved' && !reading) showSaved();
    return a;
  } catch (e) { toast('Статья не сохранилась: ' + e.message, 7000); return null; }
}
// from the feed: save an article, offer to read it
export async function saveFromFeed(x) {
  const a = await addUrl(x.link, { title: x.title, text: x.text, image: x.image, site: x.sourceName, date: x.date });
  if (a) toast('Статья сохранена: «Новости › Сохранённое»', 0, { label: 'Читать', fn: () => { import('./feed.js').then((m) => m.closeFeed()); openNews('saved').then(() => openReader(a.id)); } });
  return a;
}

// the morning digest when it is on: checked after start and every hour while Oddments runs (also in the tray)
let scheduled = false;
export function scheduleDigest() {
  if (scheduled) return;
  scheduled = true;
  const check = async () => {
    if (!(await D.digestDue()) || busy) return;
    busy = true;
    try { await D.makeDigest(); toast('Сводка дня готова', 0, { label: 'Открыть', fn: () => openNews('digest') }); } catch (e) { console.warn('digest:', e); }
    busy = false;
  };
  setTimeout(check, 15000);
  setInterval(check, 3600000);
}
