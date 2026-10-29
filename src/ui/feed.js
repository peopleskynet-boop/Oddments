// The design feed as reels (lib/feed.js gives the items): one card per screen, scrolled with the wheel, the arrows
// or a swipe and snapped into place. Each card: the picture over its own blurred copy, the source and time, the
// title and a few lines of text («ещё» opens the rest); on the right — like (lifts that source), «В Oddments» (the
// picture into the library with the article's link), translate (Claude), open on the site, hide the source.
// Clips play in Oddments' own player in the card (J/K/L/M as in the preview). Keys: ↓/↑, Space next/back, H like, S save,
// T translate, O open, Esc close.
import { lang } from '../lib/i18n.js';
import './feed.css';
import { pushLayer, popLayer } from './layers.js';
import { esc } from '../util.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { pixLoader } from './pixload.js';
import { ui } from '../state.js';
import * as F from '../lib/feed.js';
import * as P from '../lib/people.js';
import { hydrate, viewUrl } from '../lib/remote.js';

let el = null, list = null, items = [], cur = 0, io = null, loading = false;
const rel = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return rel.format(-Math.max(1, m), 'minute');
  const h = Math.round(m / 60);
  return h < 24 ? rel.format(-h, 'hour') : rel.format(-Math.round(h / 24), 'day');
}

export const isFeedOpen = () => !!(el && !el.hidden);

function build() {
  el = document.createElement('section');
  el.className = 'feed';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Лента');
  el.innerHTML = `<header class="fd-top">
      <div class="fd-tabs glass" role="tablist" aria-label="Темы">${Object.entries(F.TOPICS).map(([k, v]) => `<button type="button" role="tab" data-topic="${k}">${esc(v)}</button>`).join('')}</div>
      <button type="button" class="pill glass fd-pp" data-fd="people" aria-expanded="false" title="Кого читать во вкладке «Люди»">${ic('users')}<span>Подписки</span></button>
      <button type="button" class="pill glass fd-taste" data-fd="taste" aria-pressed="true" title="Поднимать записи, похожие на вашу библиотеку (нужен ИИ на компьютере)" hidden>${ic('sparkle')}<span>По вкусу</span></button>
      <span class="fd-count" aria-live="polite"></span>
      <button type="button" class="ib glass fd-rf" data-fd="refresh" aria-label="Обновить ленту" title="Обновить">${ic('restore')}</button>
      <button type="button" class="ib glass" data-fd="close" aria-label="Закрыть ленту" title="Закрыть (Esc)">${ic('x')}</button>
    </header>
    <div class="fd-list" tabindex="-1" aria-label="Записи ленты"></div>
    <aside class="fd-people glass" aria-label="Подписки" hidden></aside>`;
  document.body.appendChild(el);
  list = el.querySelector('.fd-list');
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey); // keys that fell out onto the page body come through layers.js (bug #126)
  // a double click on the picture likes it, as in Instagram (not on the player: there it is the player's)
  el.addEventListener('dblclick', (e) => { const r = e.target.closest('.reel'); if (r && !e.target.closest('.reel-player, .reel-rail, button')) act('like', +r.dataset.i); });
  el.addEventListener('submit', (e) => { if (e.target.matches('[data-fd="add"]')) { e.preventDefault(); addPerson(e.target); } });
  io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) activate(+e.target.dataset.i); }), { root: list, threshold: 0.6 });
}

// «По вкусу»: the feed's pictures are compared with the library in the background while the feed is open (local AI
// only), a few at a time; the order changes on the next opening or «Обновить», not under your eyes
let tasteAvailable = false, tasting = false;
async function scoreTaste() {
  if (tasting) return;
  let ai;
  try { ai = await import('../lib/ai.js'); } catch (e) { return; }
  if (!ai.aiReady() || ai.aiEngine() !== 'local') return;
  tasteAvailable = true;
  const tb = el && el.querySelector('.fd-taste');
  if (tb) tb.hidden = false;
  tasting = true;
  try {
    const todo = F.cached().filter((x) => x.image && typeof x.taste !== 'number').sort((a, b) => b.date - a.date).slice(0, 150);
    let n = 0;
    for (const x of todo) {
      if (!isFeedOpen()) break;
      await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 500 }) : setTimeout(r, 60)));
      try {
        const u = await viewUrl(x.image);
        const blob = await (await fetch(u)).blob();
        const t = await ai.tasteOf(blob);
        x.taste = typeof t === 'number' ? Math.round(t * 1e4) / 1e4 : -1;
      } catch (e) { x.taste = -1; /* not a picture the browser can read: counted as neutral, not retried */ }
      if (x.taste === -1) delete x.taste;
      if (++n % 20 === 0) F.persist();
    }
    if (n) F.persist();
  } finally { tasting = false; }
}

// a text post's body: paragraphs kept, its hidden links made clickable (bug #105), bare URLs too
function postBody(x, t) {
  let h = esc(t.text || t.title);
  for (const l of x.links || []) {
    const w = esc(l.text);
    if (w && h.includes(w)) h = h.replace(w, `<a href="${esc(l.href)}" data-url="${esc(l.href)}">${w}</a>`);
  }
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) => `${pre}<a href="${u}" data-url="${u}">${u.length > 48 ? u.slice(0, 46) + '…' : u}</a>`);
  return h.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function card(x, i) {
  const t = F.trOf(x) || x; // a translation into the other language (the interface was switched) is not shown
  const liked = F.state.liked.includes(x.id);
  return `<article class="reel" data-i="${i}" aria-label="${esc(t.title)}">
    <div class="reel-card">
      <div class="reel-bg"${x.image ? ` data-bg="${esc(x.image)}"` : ''}></div>
      <div class="reel-media" data-pic>${x.image ? `<img data-src="${esc(x.image)}" alt="" referrerpolicy="no-referrer">` : x.post ? `<div class="reel-post">${postBody(x, t)}</div><button type="button" class="reel-whole" data-fd="more">Читать целиком</button>` : `<div class="reel-noimg">${esc(x.sourceName)}</div>`}${x.video ? `<span class="reel-play">${ic('play')}</span>` : ''}</div>
      <div class="reel-text">
        <div class="reel-src"><b>${esc(x.sourceName)}</b><span>${esc(F.TOPICS[x.topic] || '')} · ${esc(ago(x.date))}</span>${x.tz != null && x.tz >= 1.2 && F.state.taste !== false ? '<i class="reel-taste" title="Похоже на картинки вашей библиотеки">✦ в вашем вкусе</i>' : ''}</div>
        ${x.post && !x.image ? '' : `<h2><button type="button" class="reel-title" data-fd="title" title="${x.telegram ? 'Открыть пост в Telegram' : 'Читать здесь (Ctrl — на сайте)'}">${esc(t.title)}</button></h2>
        ${t.text ? `<p>${esc(t.text)}</p><button type="button" class="reel-more" data-fd="more">ещё</button>` : ''}`}
      </div>
    </div>
    <div class="reel-rail">
      <button type="button" data-fd="like" aria-pressed="${liked}" title="Нравится (H или двойной клик) — чаще показывать этот источник">${ic(liked ? 'heartOn' : 'heart')}<span>Нравится</span></button>
      <button type="button" data-fd="save" title="Картинку — в библиотеку (S)">${ic('download')}<span>В Oddments</span></button>
      <button type="button" data-fd="read" title="Читать целиком здесь (R) — статья сохранится в «Новости › Сохранённое»">${ic('article')}<span>Читать</span></button>
      <button type="button" data-fd="tr" title="${lang === 'en' ? 'Перевести на английский (T)' : 'Перевести на русский (T)'}">${ic('sparkle')}<span>${F.trOf(x) ? 'Оригинал' : 'Перевести'}</span></button>
      <button type="button" data-fd="open" title="Открыть на сайте (O)">${ic('external')}<span>Открыть</span></button>
      <button type="button" data-fd="hide" title="Не показывать ${esc(x.sourceName)}">${ic('eyeOff')}<span>Скрыть</span></button>
      <button type="button" data-fd="ad" title="Это реклама — скрыть; похожие посты ${esc(x.sourceName)} тоже скроются">${ic('megaphone')}<span>Реклама</span></button>
    </div>
  </article>`;
}

function render() {
  items = F.ordered(F.cached());
  const tb = el.querySelector('.fd-taste');
  if (tb) { tb.setAttribute('aria-pressed', String(F.state.taste !== false)); tb.hidden = !tasteAvailable; }
  el.querySelectorAll('[data-topic]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.topic === F.state.topic)));
  io.disconnect();
  if (!items.length && !loading) {
    list.innerHTML = `<div class="fd-empty"><h2>Здесь пока пусто</h2><p>${F.cached().length ? 'В этой теме нет записей — выберите другую.' : 'Ленты не загрузились: проверьте интернет.'}</p><button type="button" class="pill" data-fd="refresh">Обновить</button></div>`;
    return;
  }
  list.innerHTML = items.map(card).join('');
  list.querySelectorAll('.reel').forEach((r) => io.observe(r));
  cur = 0;
  count();
}
const count = () => { el.querySelector('.fd-count').textContent = items.length ? `${cur + 1} / ${items.length}` : ''; };

// the card on screen: counted, its clip plays, pictures for the next ones are looked up
function activate(i) {
  cur = i;
  count();
  const x = items[i];
  if (x && !F.state.seen.includes(x.id)) { F.state.seen.push(x.id); F.keepState(); }
  if (clipFor !== i) stopClip();
  // pictures of this card and the next few (and one back): fetched by the app in the exe (remote.js), not all at once
  for (let k = Math.max(0, i - 1); k < Math.min(items.length, i + 4); k++) hydrate(list.querySelector(`.reel[data-i="${k}"]`));
  if (x && x.video) mountClip(i, x);
  for (let k = i; k < Math.min(items.length, i + 4); k++) if (!items[k].image) fill(k);
  checkAds(i);
}
// the next three cards' pictures are read for an ad marking printed on them (F.adOnPicture, bug #106); a found one
// hides its card before the person scrolls to it. One check at a time, each picture once (`adChk` in the cache).
let adBusy = false, adToast = false;
async function checkAds(i) {
  if (adBusy) return;
  adBusy = true;
  try {
    const O = await import('../lib/ocr.js');
    if (!O.ocrOn()) return;
    for (let k = i + 1; k < Math.min(items.length, i + 4); k++) {
      const x = items[k];
      if (!x || !x.image || x.adChk) continue;
      x.adChk = 1;
      try {
        const text = await O.readUrl(await viewUrl(x.image));
        if (!F.adOnPicture(text)) continue;
        x.adPic = 1;
        const r = list.querySelector(`.reel[data-i="${k}"]`);
        if (r && k !== cur) r.classList.add('reel-ad');
        if (!adToast) { adToast = true; toast('Скрыт рекламный пост: метка «Реклама» или erid на картинке'); }
      } catch (e) { /* a picture that cannot be read is shown as it is */ }
    }
    F.persist();
  } finally { adBusy = false; }
}
// Clips play in Oddments' own player (bug #53): Vimeo / YouTube through the site's player under our capsule, in the
// clip's own shape (Shorts 9:16, Vimeo from oEmbed), Telegram files from the app; muted at first, the sound button
// remembers the choice for the rest of the feed. One clip at a time: it stops when its card leaves the screen.
let clipFor = -1, PL = null, feedSound = false;
function stopClip() {
  if (clipFor < 0) return;
  if (PL) PL.unmountPlayer();
  list.querySelectorAll('.reel-player').forEach((h) => h.remove());
  clipFor = -1;
}
async function mountClip(i, x) {
  const media = list.querySelector(`.reel[data-i="${i}"] .reel-media`);
  if (!media || clipFor === i) return;
  clipFor = i;
  PL = PL || await import('./player.js');
  const holder = document.createElement('div');
  holder.className = 'reel-player';
  const it = { id: x.id, name: x.title, file: '', thumb: '' };
  const gone = () => cur !== i || !isFeedOpen() || clipFor !== i;
  let v;
  try {
    if (x.video.site === 'file') {
      // the clip streams straight from the site (media-src https:) and starts at once; a site that wants its own
      // Referer refuses — then the app downloads it as before (bug #98: a 40 MB clip waited for the whole download)
      media.appendChild(holder);
      const viaApp = async () => {
        holder.innerHTML = '<div class="reel-wait">Загружаю ролик…</div>';
        const src = await viewUrl(x.video.src);
        if (gone()) return;
        v = PL.mountPlayer(holder, it, () => holder.remove(), src);
        v.muted = !feedSound;
        v.addEventListener('volumechange', () => { feedSound = !v.muted; });
      };
      v = PL.mountPlayer(holder, it, () => { if (!gone()) viaApp().catch(() => holder.remove()); }, x.video.src);
    } else {
      const { videoAspect } = await import('../lib/figma.js');
      const ar = await videoAspect({ ...x.video, url: x.link });
      if (gone()) return;
      media.appendChild(holder);
      v = PL.mountPlayer(holder, it, () => holder.remove(), null, [], { site: x.video.site, id: x.video.id, ar });
    }
  } catch (e) { holder.remove(); return; }
  v.muted = !feedSound;
  v.addEventListener('volumechange', () => { feedSound = !v.muted; });
}
async function fill(k) {
  const x = items[k];
  const img = await F.pagePicture(x);
  if (!img || !isFeedOpen()) return;
  const r = list.querySelector(`.reel[data-i="${k}"]`);
  if (!r) return;
  r.querySelector('.reel-bg').dataset.bg = img;
  r.querySelector('.reel-bg').removeAttribute('data-rs');
  r.querySelector('.reel-media').innerHTML = `<img data-src="${esc(img)}" alt="" referrerpolicy="no-referrer">`;
  hydrate(r);
}

async function load(force) {
  if (loading) return;
  loading = true;
  const btn = el.querySelector('.fd-rf');
  btn.classList.add('spinning'); // not «busy»: that is the global progress pill's class (it turned this button into a wide plate)
  if (!F.cached().length || force) {
    const live = pixLoader('Собираю ленту…');
    list.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'fd-empty';
    box.appendChild(live.el);
    list.appendChild(box);
    let early = false;
    try {
      await F.refresh((d, n, failed) => {
        if (early) return;
        live.set(`Собираю ленту · ${d} из ${n} источников${failed.length ? ' · не ответили: ' + failed.length : ''}`);
        // the first sources are enough to start reading; the rest join when all have answered
        if (!force && F.ordered(F.cached()).length >= 8) { early = true; live.stop(); render(); }
      }, force);
    } finally { if (!early) live.stop(); }
    loading = false;
    btn.classList.remove('spinning');
    // read on from the early cards: the full list comes in only while the first card is still on screen (no jump)
    if (!early || cur === 0) render();
    return;
  }
  F.refresh(() => {}).then(() => { if (isFeedOpen() && !list.querySelector('.reel')) render(); }); // fresh enough: show the cache, refresh quietly
  loading = false;
  btn.classList.remove('spinning');
  render();
}

// resume: back from the reader — the same card, no reload
// a closed feed keeps its cards a while (the reader's «Назад» comes back to the same card, bug #52), then lets them
// go: thousands of hidden nodes otherwise stay in the page for the whole session (bug #125)
let dropT = 0;
export async function openFeed(resume = false) {
  if (!el) build();
  clearTimeout(dropT);
  el.hidden = false;
  el.classList.remove('leaving');
  document.body.classList.add('feed-on');
  pushLayer({ el, title: 'Лента', close: () => closeFeed(), onKey });
  sfx('open');
  if (!resume || !list.querySelector('.reel')) load(false);
  else activate(cur);
  requestAnimationFrame(() => list.focus({ preventScroll: true }));
  setTimeout(scoreTaste, 1500); // «По вкусу»: compares the pictures with the library in the background
}
// fades out like the other layers (bug #65: it vanished in one frame); at once without animations
export function closeFeed(quiet = false) {
  if (!isFeedOpen()) return;
  document.body.classList.remove('feed-on');
  popLayer(el);
  stopClip();
  if (!quiet) sfx('close');
  leave(el);
  dropT = setTimeout(() => { if (!isFeedOpen()) { io.disconnect(); list.replaceChildren(); } }, 5 * 60000);
}
export function leave(node) {
  if (!document.body.classList.contains('motion')) { node.hidden = true; return; }
  node.classList.add('leaving');
  const done = () => { if (node.classList.contains('leaving')) { node.hidden = true; node.classList.remove('leaving'); } };
  node.addEventListener('animationend', done, { once: true });
  setTimeout(done, 400);
}

const go = (d) => { const r = list.querySelector(`.reel[data-i="${Math.max(0, Math.min(items.length - 1, cur + d))}"]`); if (r) r.scrollIntoView({ behavior: document.body.classList.contains('motion') ? 'smooth' : 'auto', block: 'start' }); };

const openLink = (u) => import('@tauri-apps/plugin-opener').then((m) => m.openUrl(u)).catch(() => window.open(u, '_blank'));
async function act(a, i, btn, ev) {
  const x = items[i];
  if (!x) return;
  const reel = list.querySelector(`.reel[data-i="${i}"]`);
  if (a === 'like') {
    const on = !F.state.liked.includes(x.id);
    F.state.liked = on ? [...F.state.liked, x.id] : F.state.liked.filter((id) => id !== x.id);
    F.keepState();
    const b = reel.querySelector('[data-fd="like"]');
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = ic(on ? 'heartOn' : 'heart') + '<span>Нравится</span>';
    sfx(on ? 'fav' : 'unfav');
  } else if (a === 'save') {
    const base = x.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 90) || x.sourceName;
    // a clip with a file (Telegram): the clip itself goes to the library, not its cover
    if (x.video && x.video.site === 'file') {
      btn.disabled = true;
      try {
        const { fetch: tfetch } = await import('@tauri-apps/plugin-http');
        const r = await tfetch(x.video.src, { method: 'GET' });
        if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? 'ссылка на ролик устарела — обновите ленту' : 'HTTP ' + r.status);
        await ui.addBlobs([{ blob: await r.blob(), name: base + '.mp4', source: x.link }]);
      } catch (e) { toast('Не удалось сохранить ролик: ' + ((e && e.message) || e)); }
      btn.disabled = false;
      return;
    }
    if (!x.image) { toast('У этой записи нет картинки — откройте её на сайте'); return; }
    try {
      const { fetchImage } = await import('../lib/clipboard.js');
      const got = await fetchImage(x.image);
      const ext = (got.name.match(/\.[a-z0-9]{2,5}$/i) || ['.jpg'])[0];
      const name = base + ext;
      await ui.addBlobs([{ blob: got.blob, name, source: x.link }]);
    } catch (e) { toast('Не удалось сохранить картинку: ' + ((e && e.message) || e)); }
  } else if (a === 'read') {
    // a Telegram post is all here already: its whole text opens in the card
    if (x.telegram) { reel.classList.add('open'); return; }
    if (btn) btn.disabled = true;
    const ok = await (await import('./news.js')).readFromFeed(x);
    if (btn) btn.disabled = false;
    if (!ok) return;
  } else if (a === 'tr') {
    if (F.trOf(x) && reel.dataset.ru !== '0') { reel.dataset.ru = '0'; swapText(reel, x); return; }
    btn.disabled = true;
    try { await F.translate(x); reel.dataset.ru = '1'; swapText(reel, x.ru, true); } catch (e) { toast('Перевод не получился: ' + e.message, 6000); }
    btn.disabled = false;
  } else if (a === 'title') {
    // the title opens what it names (bug #100): a Telegram post on Telegram, an article in the reader (Ctrl — the site)
    if (x.telegram || (ev && (ev.ctrlKey || ev.metaKey))) openLink(x.link);
    else return act('read', i, btn, ev);
  } else if (a === 'open') {
    import('@tauri-apps/plugin-opener').then((m) => m.openUrl(x.link)).catch(() => window.open(x.link, '_blank'));
  } else if (a === 'hide') {
    F.state.off = [...new Set([...F.state.off, x.source])];
    F.keepState();
    toast(`${x.sourceName} больше не показывается`, 0, { label: 'Вернуть', fn: () => { F.state.off = F.state.off.filter((s) => s !== x.source); F.keepState(); render(); } });
    render();
  } else if (a === 'ad') {
    F.markAd(x);
    leave(reel);
    toast('Скрыто как реклама · похожие тоже скроются', 0, { label: 'Вернуть', fn: () => { F.markAd(x, false); render(); } });
  } else if (a === 'more') reel.classList.toggle('open');
}
function swapText(reel, t, ru) {
  reel.querySelector('h2').textContent = t.title;
  const p = reel.querySelector('.reel-text p');
  if (p) p.textContent = t.text;
  reel.querySelector('[data-fd="tr"] span').textContent = ru ? 'Оригинал' : 'Перевести';
}

/* ---------- «Люди»: who is followed, add by link, remove ---------- */
const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
function drawPeople(note = '') {
  const box = el.querySelector('.fd-people');
  const list = P.people();
  const removed = P.STARTER.length + list.filter((p) => p.mine).length - list.length;
  box.innerHTML = `<div class="pp-head"><b>Подписки <span>(${list.length})</span></b><button type="button" class="ib" data-fd="people" aria-label="Закрыть подписки">${ic('x')}</button></div>
    <p class="pp-hint">Дизайнеры, 3D- и моушн-авторы, студии — через их открытые каналы: YouTube, Vimeo, Bluesky, Behance, Substack, Medium, Mastodon, блоги. Telegram — открытые каналы по ссылке или @имени, реклама отсекается. Instagram, X, Threads и LinkedIn лент не дают — оттуда сохраняйте расширением.</p>
    <form class="pp-add" data-fd="add"><input type="text" name="url" placeholder="Профиль, канал, сайт или @telegram" aria-label="Ссылка на человека" autocomplete="off" required><button type="submit" class="pill pri">${ic('userPlus')}Добавить</button></form>
    <p class="pp-note" aria-live="polite">${esc(note)}</p>
    ${(() => { const n = Object.values(F.adsHidden).reduce((a, b) => a + b, 0); return n ? `<p class="pp-ads">Скрыто рекламных постов в каналах Telegram: ${n}</p>` : ''; })()}
    ${F.adsMarked() ? `<p class="pp-ads">Вы отметили как рекламу: ${F.adsMarked()} · <button type="button" class="pp-adclear" data-pp="adclear">Забыть отметки</button></p>` : ''}
    <div class="pp-list">${list.map((p) => `<div class="pp-row"><span class="pp-av">${esc(initials(p.name))}</span><span class="pp-t"><b>${esc(p.name)}</b><small>${esc(p.role)} · ${esc(p.kind)}</small></span>
      <button type="button" class="ib" data-pp-open="${esc(p.url)}" aria-label="Открыть ${esc(p.name)}" title="Открыть">${ic('external')}</button>
      <button type="button" class="ib" data-pp-del="${esc(p.id)}" aria-label="Убрать ${esc(p.name)}" title="Убрать из «Людей»">${ic('x')}</button></div>`).join('')}</div>
    ${removed > 0 ? `<button type="button" class="pp-restore" data-fd="restore">Вернуть стартовый список (${removed})</button>` : ''}`;
}
function togglePeople(on) {
  const box = el.querySelector('.fd-people');
  on = on ?? box.hidden;
  box.hidden = !on;
  el.querySelector('.fd-pp').setAttribute('aria-expanded', String(on));
  if (on) { drawPeople(); box.querySelector('input').focus(); }
}
async function addPerson(form) {
  const inp = form.querySelector('input'), btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const p = await P.discover(inp.value, (t) => { el.querySelector('.pp-note').textContent = t; });
    const n = await F.addSource(P.peopleSources().find((s) => s.person === p.id));
    sfx('add');
    inp.value = '';
    drawPeople(`Добавлен: ${p.name} (${p.kind}) — записей: ${n}`);
    render();
  } catch (e) { el.querySelector('.pp-note').textContent = 'Не получилось: ' + e.message; }
  btn.disabled = false;
}

function onClick(e) {
  // a link inside a post: in the exe a plain <a> opens nothing — the opener does (bug #105)
  const lk = e.target.closest('a[data-url]');
  if (lk) { e.preventDefault(); e.stopPropagation(); openLink(lk.dataset.url); return; }
  if (e.target.closest('[data-pp="adclear"]')) { F.clearAds(); drawPeople(); render(); return; }
  const del = e.target.closest('[data-pp-del]');
  if (del) { P.removePerson(del.dataset.ppDel); F.dropSource('p-' + del.dataset.ppDel); drawPeople(); render(); return; }
  const op = e.target.closest('[data-pp-open]');
  if (op) { import('@tauri-apps/plugin-opener').then((m) => m.openUrl(op.dataset.ppOpen)).catch(() => window.open(op.dataset.ppOpen, '_blank')); return; }
  const t = e.target.closest('[data-topic]');
  if (t) { F.state.topic = t.dataset.topic; F.keepState(); render(); list.scrollTop = 0; return; }
  const b = e.target.closest('[data-fd]');
  if (!b) return;
  const a = b.dataset.fd;
  if (a === 'close') closeFeed();
  else if (a === 'people') togglePeople();
  else if (a === 'restore') { P.restoreStarter(); drawPeople('Стартовый список возвращён — записи придут при обновлении'); load(true); }
  else if (a === 'refresh') load(true);
  else if (a === 'taste') { F.state.taste = F.state.taste === false; F.keepState(); render(); toast(F.state.taste ? 'По вкусу: похожие на вашу библиотеку — выше' : 'По вкусу выключено: только свежесть', 2200); }
  else { const r = b.closest('.reel'); act(a, r ? +r.dataset.i : cur, b, e); }
}
function onKey(e) {
  // typing in the people field: only Esc means something (close the panel); nothing reaches the grid
  if (e.target.closest && e.target.closest('input, textarea')) { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); togglePeople(false); el.querySelector('.fd-pp').focus(); } return; }
  const k = e.key.toLowerCase();
  const map = { arrowdown: 1, pagedown: 1, ' ': 1, arrowup: -1, pageup: -1 }; // J/K/L — the clip's player, as in the preview
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!el.querySelector('.fd-people').hidden) togglePeople(false); else closeFeed(); }
  else if (map[k] && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); go(e.shiftKey && k === ' ' ? -1 : map[k]); }
  else if (!e.ctrlKey && !e.altKey && { h: 'like', р: 'like', s: 'save', ы: 'save', t: 'tr', е: 'tr', o: 'open', щ: 'open', r: 'read', к: 'read', b: 'read', и: 'read' }[k]) {
    e.preventDefault(); e.stopPropagation();
    const a = { h: 'like', р: 'like', s: 'save', ы: 'save', t: 'tr', е: 'tr', o: 'open', щ: 'open', r: 'read', к: 'read', b: 'read', и: 'read' }[k];
    act(a, cur, list.querySelector(`.reel[data-i="${cur}"] [data-fd="${a}"]`));
  } else e.stopPropagation(); // the grid's shortcuts stay off while the feed is open
}
