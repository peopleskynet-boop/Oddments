// The design feed (Лента): fresh projects, articles and clips from open RSS feeds of design, 3D and motion sites,
// read like reels. Only open feeds — sites that forbid scraping (X, Instagram, LinkedIn, Threads) are not read;
// what you find there goes in through the browser extension. The feeds are fetched by the app (plugin-http: no
// CORS), parsed here, cached in localStorage (text and picture addresses only, ≤ 400 items) and refreshed when
// older than 30 minutes. Likes raise a source in the order; a hidden source is not shown.
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { peopleSources } from './people.js';
import { CHANNELS, parseTelegram, cutMore } from './telegram.js';
import { readPref, writePref } from './prefs.js';
import { lang } from './i18n.js';

export const SOURCES = [
  { id: 'behance', name: 'Behance', url: 'https://www.behance.net/feeds/projects', topic: 'design' },
  { id: 'dezeen', name: 'Dezeen', url: 'https://www.dezeen.com/feed/', topic: 'design' },
  { id: 'designboom', name: 'designboom', url: 'https://www.designboom.com/feed/', topic: 'design' },
  { id: 'abduzeedo', name: 'Abduzeedo', url: 'https://abduzeedo.com/rss.xml', topic: 'design' },
  { id: 'creativebloq', name: 'Creative Bloq', url: 'https://www.creativebloq.com/feeds.xml', topic: 'design' },
  { id: 'colossal', name: 'Colossal', url: 'https://www.thisiscolossal.com/feed/', topic: 'art' },
  { id: '80lv', name: '80 Level', url: 'https://80.lv/feed/', topic: '3d' },
  { id: 'cgchannel', name: 'CG Channel', url: 'https://www.cgchannel.com/feed/', topic: '3d' },
  { id: 'blendernation', name: 'BlenderNation', url: 'https://www.blendernation.com/feed/', topic: '3d' },
  { id: 'motionographer', name: 'Motionographer', url: 'https://motionographer.com/feed/', topic: 'motion' },
  { id: 'vimeo', name: 'Vimeo Staff Picks', url: 'https://vimeo.com/channels/staffpicks/videos/rss', topic: 'motion' },
  { id: 'awwwards', name: 'Awwwards', url: 'https://www.awwwards.com/blog/feed/', topic: 'ux' },
  { id: 'smashing', name: 'Smashing', url: 'https://www.smashingmagazine.com/feed/', topic: 'ux' },
  { id: 'uxcollective', name: 'UX Collective', url: 'https://uxdesign.cc/feed', topic: 'ux' },
  // from the user (checked 20.10.2026): branding & packaging, alternative web design
  { id: 'bpando', name: 'BP&O', url: 'https://bpando.org/feed/', topic: 'design' },
  { id: 'hoverstates', name: 'hoverstat.es', url: 'https://www.hoverstat.es/rss.xml', topic: 'ux' },
  // fintech for the bank's product designers (checked 25.10.2026: open RSS, fresh posts): what banks and wallets ship
  { id: 'finextra', name: 'Finextra', url: 'https://www.finextra.com/rss/headlines.aspx', topic: 'fintech' },
  { id: 'bankingdive', name: 'Banking Dive', url: 'https://www.bankingdive.com/feeds/news/', topic: 'fintech' },
  { id: 'fintechglobal', name: 'FinTech Global', url: 'https://fintech.global/feed/', topic: 'fintech' },
  { id: 'pymnts', name: 'PYMNTS', url: 'https://www.pymnts.com/feed/', topic: 'fintech' },
  { id: 'frank', name: 'Frank Media', url: 'https://frankmedia.ru/feed', topic: 'fintech' },
  { id: 'tj', name: 'Т—Ж', url: 'https://t-j.ru/feed/', topic: 'fintech' },
  // FrameRate (framerate.tv, a video platform for creatives; bug #54): no RSS and no public API — its public video
  // sitemap for search engines (title, description, cover, direct MP4, date); 10 MB, unsorted, no ranges → read at
  // most twice a day, the 40 newest of the last month
  { id: 'framerate', name: 'FrameRate', url: 'https://framerate.tv/sitemap-videos-1.xml', topic: 'motion', framerate: true, every: 12 * 3600000 },
  // the user's Telegram channels (telegram.js): read through their public web preview, ads left out
  ...CHANNELS,
];
export const TOPICS = { all: 'Всё', people: 'Люди', ai: 'ИИ', design: 'Дизайн', fintech: 'Финтех', '3d': '3D', motion: 'Моушн', ux: 'UX и веб', art: 'Искусство' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Oddments';
const CACHE = 'perch.feed.cache', STATE = 'perch.feed', FRESH_MS = 30 * 60000, KEEP = 900;
// Telegram channels are read gently: at most every 2 hours (every 15 minutes when «Обновить» is pressed)
const TG_MS = 2 * 3600000, TG_FORCE_MS = 15 * 60000;
const load = readPref;
const save = writePref; // full or private: kept in memory

// what the person did: liked items, hidden sources, the chosen topic, items seen
export const state = load(STATE, { liked: [], off: [], topic: 'all', seen: [] });
if (!Array.isArray(state.ads)) state.ads = [];

// «Это реклама» on a card (bug #106, the person's own marking): the post is hidden, and its words are kept as a sample
// of that source's ads — a later post of the same source that shares most of its words (promo texts repeat: the same
// product, the same promo code, the same call to action) is hidden too. Samples: the last 200, words of 4+ letters.
const adWords = (x) => new Set(String((x.title || '') + ' ' + (x.text || '')).toLowerCase().replace(/ё/g, 'е')
  .split(/[^a-zа-я0-9]+/i).filter((w) => w.length >= 4).slice(0, 80));
export function markAd(x, on = true) {
  x.adMine = on ? 1 : 0;
  if (on) state.ads = [...state.ads, { source: x.source, id: x.id, words: [...adWords(x)] }].slice(-200);
  else state.ads = state.ads.filter((a) => a.id !== x.id);
  keepState();
  persist();
}
// does a post look like one the person marked as an ad (same source, ≥ 45 % of the smaller word set shared)?
export function looksLikeAd(x) {
  if (x.adMine) return true;
  const mine = state.ads.filter((a) => a.source === x.source && a.id !== x.id);
  if (!mine.length) return false;
  const w = adWords(x);
  if (w.size < 6) return false;
  return mine.some((a) => {
    let both = 0;
    for (const t of a.words) if (w.has(t)) both++;
    return both >= 5 && both / Math.min(w.size, a.words.length) >= 0.45;
  });
}
export const adsMarked = () => state.ads.length;
export function clearAds() { state.ads = []; for (const x of cache.items) delete x.adMine; keepState(); persist(); }
export const keepState = () => { state.seen = state.seen.slice(-1500); save(STATE, state); };
let cache = load(CACHE, { at: 0, items: [] });

/* ---------- reading a feed ---------- */
const text = (el) => (el ? el.textContent.trim() : '');
const first = (el, ...names) => { for (const n of names) { const x = el.getElementsByTagName(n)[0]; if (x) return x; } return null; };
const plain = (html) => {
  const d = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
};
const absUrl = (u, base) => { try { return new URL(u.startsWith('//') ? 'https:' + u : u, base).href; } catch (e) { return ''; } };
// the first real picture in some HTML (not a 1×1 counter, not an emoji, not an avatar)
function htmlPicture(html, base) {
  if (!html) return '';
  const d = new DOMParser().parseFromString(html, 'text/html');
  for (const img of d.querySelectorAll('img')) {
    const w = +img.getAttribute('width') || 0, h = +img.getAttribute('height') || 0;
    const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (!src || (w && w < 40) || (h && h < 40) || /emoji|gravatar|avatar|pixel|feedburner|stat\?/i.test(src)) continue;
    return absUrl(src, base);
  }
  return '';
}
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

export const SPONSORED = /\[sponsored\]|\bsponsored\b|\bpartner content\b|\bpaid (post|content|partnership)\b|\bpromoted\b|\badvertorial\b|\bbrand(ed)? content\b|спецпроект|на правах рекламы|партн[её]рский материал/i;
export function parseFeed(xml, src) {
  let doc = new DOMParser().parseFromString(xml, 'text/xml');
  // a bare «&» in a picture address (Motionographer, bug #124) breaks strict XML: escape and read again
  if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(xml.replace(/&(?!(?:[a-zA-Z][\w.-]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;'), 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('лента не читается');
  const entries = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagName('entry')];
  return entries.slice(0, 40).map((e) => {
    const linkEl = first(e, 'link');
    const link = (linkEl && (linkEl.getAttribute('href') || text(linkEl))) || text(first(e, 'guid'));
    const desc = text(first(e, 'description', 'summary', 'media:description'));
    const body = text(first(e, 'content:encoded', 'content'));
    // a picture: media:thumbnail (YouTube), media:content only when it is an image (YouTube's is an old Flash player)
    const mc = [...e.getElementsByTagName('media:content')].find((m) => /^image\//.test(m.getAttribute('type') || '') || m.getAttribute('medium') === 'image' || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(m.getAttribute('url') || ''));
    const media = first(e, 'media:thumbnail') || mc;
    const encl = [...e.getElementsByTagName('enclosure')].find((x) => /^image\//.test(x.getAttribute('type') || ''));
    const image = (media && media.getAttribute('url')) || (encl && encl.getAttribute('url')) || htmlPicture(body, link) || htmlPicture(desc, link);
    const date = Date.parse(text(first(e, 'pubDate', 'published', 'updated', 'dc:date'))) || Date.now();
    const vimeo = /vimeo\.com\/(?:.*\/)?(\d{6,})/.exec(link);
    const youtube = /youtube\.com\/(?:watch\?v=|shorts\/)([\w-]{11})/.exec(link);
    // a post without a title (Bluesky, Mastodon): its first words are the title, the card shows it as a post
    const own = plain(text(first(e, 'title')));
    const said = cutMore(plain(desc || body));
    // paid posts are ads too (bug #106): «[Sponsored]», «Partner content», «Спецпроект»… in the title, text or categories
    const cats = [...e.getElementsByTagName('category')].map((c) => text(c)).join(' ');
    if (SPONSORED.test(own + ' ' + said.slice(0, 200) + ' ' + cats)) return null;
    return {
      id: src.id + '-' + hash(link || own || said),
      source: src.id, sourceName: src.name, topic: src.topic, ...(src.person ? { person: src.person } : {}), ...(own ? {} : { post: true }),
      title: (own || said.split(/(?<=[.!?])\s/)[0]).slice(0, 200), link, date,
      text: said.slice(0, 600),
      image: image ? absUrl(image, link) : '',
      video: vimeo ? { site: 'Vimeo', id: vimeo[1] } : youtube ? { site: 'YouTube', id: youtube[1] } : null,
    };
  }).filter((x) => x && x.title && /^https?:/i.test(x.link));
}

const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('сайт не ответил')), ms))]);
// ad posts left out of Telegram channels, by source (for «скрыто рекламы: N»)
export const adsHidden = {};
const xmlText = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function parseFrameRate(xml, src) {
  const out = [];
  const month = Date.now() - 30 * 864e5;
  for (const chunk of xml.split('<url>').slice(1)) {
    const get = (t) => { const m = chunk.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? xmlText(m[1].trim()) : ''; };
    const date = Date.parse(get('video:publication_date')) || 0;
    if (date < month) continue;
    const link = get('loc'), mp4 = get('video:content_loc');
    if (!link || !mp4) continue;
    out.push({ id: src.id + '-' + link.split('/').pop(), source: src.id, sourceName: src.name, topic: src.topic, title: get('video:title').slice(0, 200) || 'FrameRate',
      text: get('video:description').slice(0, 600), link, date, image: get('video:thumbnail_loc'), video: { site: 'file', src: mp4, poster: get('video:thumbnail_loc') } });
  }
  return out.sort((a, b) => b.date - a.date).slice(0, 40);
}

export async function readSource(src) {
  if (src.framerate) {
    const r = await timeout(tfetch(src.url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/xml' } }), 60000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return parseFrameRate(await r.text(), src);
  }
  if (src.telegram) {
    const r = await timeout(tfetch(src.url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'ru,en' } }), 15000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { items, ads } = parseTelegram(await r.text(), src);
    adsHidden[src.id] = ads;
    return items;
  }
  const r = await timeout(tfetch(src.url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } }), 15000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return parseFeed(await r.text(), src);
}

/* ---------- the feed ---------- */
// → items; onProgress(done, total, failedNames)
export async function refresh(onProgress = () => {}, force = false) {
  if (!force && cache.items.length && Date.now() - cache.at < FRESH_MS) return cache.items;
  const all = [...SOURCES, ...peopleSources()].filter((s) => !state.off.includes(s.id));
  const tgAt = cache.tgAt || {};
  // a channel read not long ago keeps its items from the cache instead of being asked again
  const rest = all.filter((s) => (s.telegram || s.every) && Date.now() - (tgAt[s.id] || 0) < (s.every ? (force ? s.every / 4 : s.every) : force ? TG_FORCE_MS : TG_MS));
  const list = all.filter((s) => !rest.includes(s));
  const got = cache.items.filter((x) => rest.some((s) => s.id === x.source)), failed = [];
  // the very first read shows what has come so far (cached() grows while the slow sources still answer): the screen
  // was empty ~15 s until the last one did (audit 29.10). Not saved until all are in.
  const first = !cache.items.length;
  let done = 0;
  const queue = list.slice();
  const worker = async () => {
    for (let s; (s = queue.shift());) {
      try { got.push(...await readSource(s)); if (s.telegram || s.every) tgAt[s.id] = Date.now(); } catch (e) { failed.push(s.name); console.warn('feed:', s.name, e); }
      if (first) { const seen = new Set(); cache.items = got.filter((x) => !seen.has(x.id) && seen.add(x.id)).sort((a, b) => b.date - a.date); }
      onProgress(++done, list.length, failed);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  if (!got.length && cache.items.length) return cache.items; // offline: what was read last time
  // pictures found earlier for items without one (og:image) are kept
  const old = new Map(cache.items.map((x) => [x.id, x]));
  got.forEach((x) => { const o = old.get(x.id); if (o) { if (!x.image && o.image) x.image = o.image; if (o.ru) x.ru = o.ru; } });
  const seen = new Set();
  cache = { at: Date.now(), tgAt, items: got.filter((x) => !seen.has(x.id) && seen.add(x.id)).sort((a, b) => b.date - a.date).slice(0, KEEP) };
  save(CACHE, cache);
  return cache.items;
}
export const cached = () => cache.items;
// a person just added: their items join the cache at once, without reading every source again
export async function addSource(src) {
  const got = await readSource(src);
  const have = new Set(cache.items.map((x) => x.id));
  cache.items = [...cache.items, ...got.filter((x) => !have.has(x.id))].sort((a, b) => b.date - a.date).slice(0, KEEP);
  save(CACHE, cache);
  return got.length;
}
// a person removed: their items leave the cache
export function dropSource(id) { cache.items = cache.items.filter((x) => x.source !== id); save(CACHE, cache); }
export const persist = () => save(CACHE, cache);

// The order: newer first, liked sources lifted (a like is worth ~a day of freshness, up to three), no more than two
// from one source in a row, the topic filter, hidden sources out
export function ordered(items, topic = state.topic) {
  const likedBy = {};
  const byId = new Map(items.map((x) => [x.id, x]));
  state.liked.forEach((id) => { const x = byId.get(id); if (x) likedBy[x.source] = (likedBy[x.source] || 0) + 1; });
  const now = Date.now();
  // «По вкусу» (ai.js tasteOf): pictures like the ones in the library come up to a day and a half earlier; the scores are
  // compared with each other (z), not taken as they are
  const tasted = items.filter((x) => typeof x.taste === 'number');
  const tm = tasted.reduce((a, x) => a + x.taste, 0) / (tasted.length || 1);
  const ts = Math.sqrt(tasted.reduce((a, x) => a + (x.taste - tm) ** 2, 0) / (tasted.length || 1)) || 1;
  for (const x of items) x.tz = typeof x.taste === 'number' && tasted.length >= 8 ? (x.taste - tm) / ts : null;
  const tasteOn = state.taste !== false;
  const score = (x) => -(now - x.date) / 3600000 + Math.min(3, likedBy[x.source] || 0) * 24 + (tasteOn && x.tz != null ? Math.max(-1, Math.min(2.5, x.tz)) * 14 : 0);
  const pool = items.filter((x) => !x.adPic && !looksLikeAd(x) && !state.off.includes(x.source) && (topic === 'all' || x.topic === topic)).sort((a, b) => score(b) - score(a));
  const out = [];
  while (pool.length) {
    const i = pool.findIndex((x) => !(out.length >= 2 && out[out.length - 1].source === x.source && out[out.length - 2].source === x.source));
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

// Ads whose marking is printed on the picture itself (bug #106: «erid: 2VtzwqQVpb7» in the corner of a Telegram
// post's picture, nothing in its text). The text on the picture is read on this computer (ocr.js) for the next cards
// ahead of the one on screen; a found marking hides the card (`adPic`, kept in the cache), `adChk` — read once.
const AD_PIC = /\berid\b|erid\s*[:=]|(^|[\s.])реклама([.:\s]|$)|на правах рекламы|рекламодатель|\bsponsored\b|\badvertisement\b|партн[её]рский материал/im;
export const adOnPicture = (text) => AD_PIC.test(text || '');

// an article without a picture in its feed: the page's own preview picture (og:image), asked once
const asked = new Set();
export async function pagePicture(item) {
  // not for Telegram posts: a post's page has the channel's avatar as its picture (bug #97)
  if (item.image || item.telegram || asked.has(item.id)) return item.image;
  asked.add(item.id);
  try {
    const r = await timeout(tfetch(item.link, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'text/html' } }), 12000);
    const html = await r.text();
    const d = new DOMParser().parseFromString(html, 'text/html');
    const m = d.querySelector('meta[property="og:image"], meta[name="twitter:image"]');
    item.image = m ? absUrl(m.getAttribute('content') || '', item.link) : '';
    if (item.image) persist();
  } catch (e) { /* stays without a picture */ }
  return item.image;
}

// The title and text in the interface's language through Claude (the Anthropic key from Settings), kept with the item
// (`ru` keeps its name: older caches have it; `lang` says which language it is, Russian when absent)
export const trOf = (item) => (item.ru && (item.ru.lang || 'ru') === lang ? item.ru : null);
export async function translate(item) {
  if (trOf(item)) return item.ru;
  const { aiPrefs } = await import('./iconai.js');
  const key = aiPrefs().key;
  if (!key) throw new Error('Нужен ключ Anthropic: Настройки › «Ключ Anthropic»');
  const inApp = !!window.__TAURI_INTERNALS__;
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  headers['anthropic-dangerous-direct-browser-access'] = 'true'; // the exe sends an Origin too (bug #110)
  const r = await tfetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({
    model: 'claude-haiku-5-5', max_tokens: 900,
    system: `Переведи заголовок и текст новости о дизайне ${lang === 'en' ? 'на английский' : 'на русский'}, живо и коротко, без пояснений. Ответ — только JSON: {"title":"…","text":"…"}`,
    messages: [{ role: 'user', content: JSON.stringify({ title: item.title, text: item.text }) }],
  }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'ключ не подошёл' : (j.error && j.error.message) || 'HTTP ' + r.status);
  const t = (j.content || []).map((c) => c.text || '').join('');
  const m = t.match(/\{[\s\S]*\}/);
  const ru = m ? JSON.parse(m[0]) : null;
  if (!ru || !ru.title) throw new Error('перевод не пришёл');
  item.ru = { title: String(ru.title), text: String(ru.text || ''), lang };
  persist();
  return item.ru;
}
