// Oddments for Chrome, Edge, Zen and Firefox: the background (a service worker in Chrome, an event page in Gecko — the
// same file). Everything goes to the Oddments window on this computer through its local receiver (127.0.0.1, ports
// 47215–47219, the token from Oddments › Настройки › Интеграции):
//   POST /import?name&source&token&folder&tags — one file; the folder and tags chosen in the popup go along. A board
//        import (1.7) puts JSON into `folder` instead of an id: the collections of the board and the file's id there.
//   GET  /library?token — folders and tags for the popup's picker, the app's language, the ids of boards' files already in.
// Pictures are downloaded here (host permissions: no CORS), so the page's own scripts never see the token.

import './i18n.js';
import { muxAV, pinterestHls } from './fmp4.js';

const PORTS = [47215, 47216, 47217, 47218, 47219];
const VIDEO_URLS = [
  { site: 'YouTube', re: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})[^\s]*/i },
  { site: 'Vimeo', re: /^https?:\/\/(?:www\.)?vimeo\.com\/(?:.*\/)?(\d{5,})[^\s]*/i },
  { site: 'Pinterest', re: /^https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?pinterest\.[a-z.]+\/pin\/([\w-]+)[^\s]*/i },
];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'image/bmp': 'bmp', 'image/x-icon': 'ico', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const KNOWN = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|mp4|webm|mov|m4v)$/i;

export const DEFAULTS = { token: '', folder: '', tags: [], altClick: true, hoverBtn: true, minSize: 200 };
export const prefs = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) });

/* ---------- talking to Oddments ---------- */
let port = null;
async function findPerch() {
  if (port) {
    try { const r = await fetch(`http://127.0.0.1:${port}/ping`); if ((await r.json()).app === 'perch') return port; } catch (e) { port = null; }
  }
  for (const p of PORTS) {
    try { const r = await fetch(`http://127.0.0.1:${p}/ping`, { signal: AbortSignal.timeout(800) }); if ((await r.json()).app === 'perch') return (port = p); } catch (e) { /* next */ }
  }
  return null;
}

// fatal: Oddments is off or the token is wrong — no use trying the next file
class PerchError extends Error { constructor(m, fatal) { super(m); this.fatal = !!fatal; } }
async function endpoint(path, params = {}) {
  const p = await prefs();
  const at = await findPerch();
  if (!at) throw new PerchError(T('Oddments не запущен: откройте приложение'), true);
  if (!p.token) throw new PerchError(T('Нет токена: вставьте его в окне расширения'), true);
  const q = new URLSearchParams({ ...params, token: p.token });
  return { url: `http://127.0.0.1:${at}${path}?${q}`, p };
}

async function sendBlob(blob, name, source, tags, folder) {
  const params = await target({ name: cleanName(name), source: source || '' }, tags);
  if (folder != null) params.folder = folder;
  const { url } = await endpoint('/import', params);
  let r;
  try { r = await fetch(url, { method: 'POST', body: blob }); } catch (e) { port = null; throw new PerchError(T('Oddments не ответил'), true); }
  if (r.status === 401) throw new PerchError(T('Токен не подошёл: скопируйте его заново в Oddments › Настройки'), true);
  if (!r.ok) throw new PerchError(T('Oddments ответил ') + r.status);
}
// the folder and tags from the popup (and the tags a saved thing brings itself — a grabbed block's kind, site, fonts)
async function target(params, own) {
  const p = await prefs();
  const tags = [...new Set([...(p.tags || []), ...(own || [])].map((t) => String(t).trim()).filter(Boolean))];
  return { ...params, folder: p.folder || '', tags: tags.join('\n') };
}

export async function status() {
  const at = await findPerch();
  if (!at) return { state: 'off' };
  const p = await prefs();
  if (!p.token) return { state: 'token' };
  try {
    const r = await fetch(`http://127.0.0.1:${at}/library?token=${encodeURIComponent(p.token)}`);
    if (r.status === 401) return { state: 'bad' };
    const catalog = await r.json();
    // the extension speaks the app's language unless the popup chose one (i18n.js)
    if (catalog.lang && (await chrome.storage.local.get('appLang')).appLang !== catalog.lang) chrome.storage.local.set({ appLang: catalog.lang });
    return { state: 'ok', catalog };
  } catch (e) { return { state: 'off' }; }
}

/* ---------- names and downloads ---------- */
function cleanName(n) {
  return (n || 'image').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'image';
}
function nameFromUrl(u) {
  try { return decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || ''); } catch (e) { return ''; }
}
const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`; };

async function download(url) {
  let r = await fetch(url, { credentials: 'include' });
  if (r.status === 401 || r.status === 403) r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new PerchError(T('Сайт не отдал файл (') + r.status + ')');
  const blob = await r.blob();
  const type = (r.headers.get('content-type') || blob.type || '').split(';')[0].trim();
  return { blob, type };
}

// a picture or a video file by URL; `hint` names it when the URL does not
async function saveFile(url, page, hint, named) {
  if (/^blob:/i.test(url)) throw new PerchError(T('Это поток из скрипта страницы, сохранить его нельзя'));
  const { blob, type } = await download(url);
  if (type === 'text/html') throw new PerchError(T('По ссылке страница, а не файл'));
  // `named` — a name the page knows better than the URL (an Instagram video's file name is a hash)
  let name = named ? cleanName(named) : /^data:/i.test(url) ? '' : nameFromUrl(url);
  // the extension follows what the site sent: Behance serves WebP under «….jpg» from its /1400_webp/ folder
  const real = EXT[type] || '';
  const own = (name.match(/\.([a-z0-9]{1,5})$/i) || [])[1] || '';
  if (!KNOWN.test(name) || (real && own.toLowerCase().replace('jpeg', 'jpg') !== real)) {
    name = (name.replace(/\.[a-z0-9]{1,5}$/i, '') || cleanName(hint) || 'image') + (real ? '.' + real : '');
  }
  await sendBlob(blob, name, page || (/^https?:/i.test(url) ? url : ''));
  return name;
}

// A .url shortcut. [Oddments] carries what the open page showed (pageInfo): the picture, title, description, site and
// icon — Oddments draws the link's card from them (src/lib/linkmeta.js reads the same section; Windows ignores it). The
// person's browser gets past Cloudflare and bot walls (ArtStation, Dribbble) that stop Oddments' own request.
const one = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const shortcut = (url, o = {}) => {
  const extra = [['Title', o.title], ['Description', o.desc], ['Site', o.site], ['Icon', o.icon], ['Image', o.image]].filter(([, v]) => one(v));
  return new Blob([`[InternetShortcut]\r\nURL=${one(url)}\r\n` + (extra.length ? '[Oddments]\r\n' + extra.map(([k, v]) => `${k}=${one(v)}\r\n`).join('') : '')], { type: 'application/x-url' });
};
const samePage = (a, b) => { try { const x = new URL(a), y = new URL(b); x.hash = y.hash = ''; return x.href === y.href; } catch (e) { return false; } };

// what the open page says about itself, read in the page: Open Graph and Twitter cards, the title, the sharpest icon
async function pageInfo(tab) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const m = (k) => { const e = document.querySelector(`meta[property="${k}"], meta[name="${k}"]`); return e ? (e.getAttribute('content') || '').trim() : ''; };
      const abs = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };
      const px = (s) => { const k = /(\d+)x\d+/i.exec(s || ''); return k ? +k[1] : 0; };
      const icons = [...document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]')]
        .map((l) => ({ href: abs(l.getAttribute('href') || ''), score: /apple-touch/.test(l.rel) ? 300 : /svg/.test(l.type || l.getAttribute('href') || '') ? 250 : Math.min(px(l.getAttribute('sizes')), 256) }))
        .filter((i) => i.href).sort((a, b) => b.score - a.score);
      return {
        image: abs(m('og:image:secure_url') || m('og:image') || m('og:image:url') || m('twitter:image') || m('twitter:image:src')),
        title: m('og:title') || m('twitter:title') || document.title || '',
        desc: m('og:description') || m('twitter:description') || m('description'),
        site: m('og:site_name') || m('application-name'),
        icon: (icons[0] && icons[0].href) || abs('/favicon.ico'),
      };
    } });
    return (r && r.result) || null;
  } catch (e) { return null; } // a page the extension cannot read (the store, a PDF viewer): the address alone
}
// a page without a picture of its own: the visible part of it, as a JPEG up to 1280 px (the cover of the card)
async function pageShot(tab) {
  const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
  const bmp = await createImageBitmap(await (await fetch(data)).blob());
  const s = Math.min(1, 1280 / bmp.width), c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(bin);
}
const videoOf = (u) => { for (const v of VIDEO_URLS) { const m = (u || '').match(v.re); if (m) return { url: m[0], site: v.site, id: m[1] }; } return null; };

async function videoTitle(v) {
  const api = v.site === 'YouTube' ? 'https://www.youtube.com/oembed?format=json&url=' : v.site === 'Vimeo' ? 'https://vimeo.com/api/oembed.json?url=' : '';
  if (!api) return '';
  try { const r = await fetch(api + encodeURIComponent(v.url)); return r.ok ? ((await r.json()).title || '').trim() : ''; } catch (e) { return ''; }
}

// a link card: YouTube / Vimeo / Pinterest get their cover in Oddments; any other page — when it is the page open in
// the tab, with what the page showed (pageInfo), and a shot of it if it has no picture; a link to another page — the
// address alone (Oddments reads that page itself)
async function saveLink(url, title, tab) {
  // only web addresses: a javascript:, file: or search-ms: link would become a .url that Windows hands to its handler
  if (!/^https?:\/\//i.test(url || '')) throw new PerchError(T('Сохраняются только веб-ссылки (http/https)'));
  const v = videoOf(url);
  if (v) title = (await videoTitle(v)) || title || `${v.site} ${v.id}`;
  title = cleanName((title || '').replace(/\s+[-–—|]\s+(YouTube|Vimeo|Pinterest)$/i, '') || hostOf(url));
  let info = null;
  if (!v) {
    tab = tab || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []))[0];
    if (tab && samePage(tab.url, url)) {
      info = await pageInfo(tab);
      if (info && !info.image) info.image = await pageShot(tab).catch(() => '');
    }
  }
  await sendBlob(shortcut(v ? v.url : url, info || {}), title + '.url', url);
  return title;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return T('Ссылка'); } };

/* ---------- screenshots ---------- */
async function shotVisible(tab) {
  const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const blob = await (await fetch(data)).blob();
  const name = T('Снимок {site} {time}.png', { site: hostOf(tab.url), time: stamp() });
  await sendBlob(blob, name, tab.url);
  return name;
}

async function shotArea(tab) {
  const pick = await ask(tab, { t: 'pickArea' });
  if (!pick || !pick.w || !pick.h) return null; // cancelled
  const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(data)).blob());
  const k = bmp.width / pick.vw; // device pixels per CSS pixel, as captured
  const x = Math.round(pick.x * k), y = Math.round(pick.y * k), w = Math.round(pick.w * k), h = Math.round(pick.h * k);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const name = T('Снимок {site} {time}.png', { site: hostOf(tab.url), time: stamp() });
  await sendBlob(blob, name, tab.url);
  return name;
}

/* ---------- a video of an area ---------- */
// Chrome and Edge: the tab is captured (tabCapture) in an offscreen page (offscreen.js) that crops every frame to the
// frame drawn on the page and records it with the tab's sound; the page shows the frame and a bar (time, pause, stop,
// cancel). The recording's state lives in the offscreen page — this worker may be stopped meanwhile.
// Zen and Firefox have neither tabCapture nor offscreen pages: the page itself asks for «show the screen» on the click
// of «Начать запись», finds the frame on what it gets and records it there (content.js recLocal) — WebM, no sound.
// The file goes to Oddments like any other; when Oddments is not there, to the browser's downloads.
const MAX_REC = 5 * 60 * 1000;
const toOff = (msg) => chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
const offOpen = () => (chrome.offscreen ? chrome.offscreen.hasDocument() : Promise.resolve(false));
const recState = async () => ((await offOpen()) ? (await toOff({ t: 'recState' }).catch(() => null)) || { on: false } : { on: false });
const closeOff = () => (chrome.offscreen ? chrome.offscreen.closeDocument().catch(() => {}) : Promise.resolve());

async function recordArea(tab) {
  if ((await recState()).on) { await toOff({ t: 'recCtl', do: 'stop' }); return null; } // the same command again stops
  const name = T('Видео {site} {time}', { site: hostOf(tab.url), time: stamp() });
  if (!chrome.tabCapture || !chrome.offscreen) {
    const r = await ask(tab, { t: 'recLocal', max: MAX_REC, name, page: tab.url });
    if (r === undefined) throw new PerchError(T('Здесь браузер не даёт записывать — откройте обычную страницу сайта'));
    if (r && r.error) throw new PerchError(r.error);
    return null; // the toast comes with the file
  }
  // the frame, then «Начать запись» (or «Вся вкладка»): the area can be moved and resized before the recording starts
  const pick = await ask(tab, { t: 'pickArea', video: true, label: T('Выделите область для видео · Esc — отмена') });
  if (!pick || !pick.w || !pick.h) return null; // cancelled
  // the id lives a few seconds: taken after the frame is drawn
  let streamId;
  try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }); } catch (e) { throw new PerchError(T('Эту вкладку не записать: ') + ((e && e.message) || e)); }
  if (!(await offOpen())) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Records a selected area of the tab as a video' });
  const r = await toOff({ t: 'recStart', streamId, pick, tabId: tab.id, name, page: tab.url });
  if (!r || r.error) throw new PerchError(T('Запись не началась: ') + ((r && r.error) || ''));
  await ask(tab, { t: 'recUi', rect: pick, elapsed: 0, paused: false, max: MAX_REC });
  return null; // the toast comes with the file
}

// the recording has stopped (offscreen.js): the file to Oddments, or to the downloads when Oddments is not there
async function recordingDone(m) {
  const tab = await chrome.tabs.get(m.tabId).catch(() => null);
  if (tab) await ask(tab, { t: 'recEnd' });
  if (m.cancelled) { await closeOff(); return; }
  if (!m.size) { await say(tab, T('Запись пустая'), 'err'); await closeOff(); return; }
  const name = cleanName(m.name) + (/mp4/.test(m.type) ? '.mp4' : '.webm');
  if (tab) await ask(tab, { t: 'toast', text: T('Сохраняю видео…'), kind: 'busy' });
  try {
    await sendBlob(await (await fetch(m.url)).blob(), name, m.page);
    await say(tab, T('В Oddments: ') + name);
    await closeOff();
  } catch (e) {
    if (!(e instanceof PerchError && e.fatal)) { await failed(tab, e); await closeOff(); return; }
    // Oddments is off or not paired: the video is not lost
    const id = await chrome.downloads.download({ url: m.url, filename: name });
    await say(tab, e.message + T(' — видео в загрузках'), 'err');
    const done = (d) => { if (d.id === id && d.state && d.state.current !== 'in_progress') { chrome.downloads.onChanged.removeListener(done); closeOff(); } };
    chrome.downloads.onChanged.addListener(done);
  }
}

// a page of the recorded tab opened anew (a link was followed): the frame and the bar come back on it
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const s = await recState();
  if (s.on && s.tabId === tabId) ask(tab, { t: 'recUi', rect: s.rect, elapsed: s.elapsed, paused: s.paused, max: s.max });
});

/* ---------- the page side ---------- */
// a message to the tab's content script; scripts that were not there yet (tabs opened before the install) are injected
async function ask(tab, msg) {
  try { return await chrome.tabs.sendMessage(tab.id, msg); } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['i18n.js', 'content.js', 'block.js'] });
      return await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e2) { return undefined; }
  }
}
async function say(tab, text, kind = 'ok') {
  if (tab && tab.id != null && (await ask(tab, { t: 'toast', text, kind })) !== undefined) return;
  // pages without the script (chrome://, the web store): the badge says it
  chrome.action.setBadgeBackgroundColor({ color: kind === 'err' ? '#ff2e88' : '#d7ff63' });
  chrome.action.setBadgeText({ text: kind === 'err' ? '!' : '✓' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}
const failed = (tab, e) => say(tab, e instanceof PerchError ? e.message : T('Не получилось: ') + ((e && e.message) || e), 'err');
async function run(tab, job, okText) {
  try { const r = await job(); if (r !== null) await say(tab, okText(r)); } catch (e) { await failed(tab, e); }
}

async function saveMany(tab, items) {
  let ok = 0, bad = 0;
  await ask(tab, { t: 'toast', text: T('В Oddments: {n} из {all}…', { n: 0, all: items.length }), kind: 'busy' });
  // three at a time: fast, but no flood on the site or on Oddments
  const queue = items.slice();
  const worker = async () => {
    for (let it; (it = queue.shift());) {
      try { if (it.embed) await saveEmbed(tab, null, it.embed, tab.url); else await saveFile(it.url, tab.url, it.alt); ok++; } catch (e) { bad++; if (e instanceof PerchError && e.fatal) { queue.length = 0; throw e; } }
      await ask(tab, { t: 'toast', text: T('В Oddments: {n} из {all}…', { n: ok, all: items.length }), kind: 'busy' });
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); } catch (e) { return failed(tab, e); }
  await say(tab, T('В Oddments: ') + ok + (bad ? T(' · не скачалось: ') + bad : ''), bad && !ok ? 'err' : 'ok');
}

/* ---------- Vimeo embeds: Behance «GIFs» ---------- */
// Behance shows its looping animations as background Vimeo players (an iframe, background=1). The file is not in the
// page: the player in its frame keeps a config with an HLS stream whose pieces are byte ranges of one fragmented
// MP4 (an init part + moof/mdat parts). The config is read in that frame (scripting, MAIN world — the frame
// already has the right referrer, so domain-locked videos work too), the pieces are fetched here and glued back
// into one .mp4. A video with sound (not a background player) goes to Oddments as a Vimeo link instead: its sound is
// a separate stream that cannot be glued in without remuxing.
const VIMEO_FRAME = /^https:\/\/player\.vimeo\.com\/video\/(\d+)/i;
const MAX_VIDEO = 500 * 1024 * 1024;

async function vimeoConfigs(tabId, frameId) {
  const target = frameId != null ? { tabId, frameIds: [frameId] } : { tabId, allFrames: true };
  const res = await chrome.scripting.executeScript({
    target, world: 'MAIN',
    func: () => {
      const c = window.playerConfig;
      if (location.hostname !== 'player.vimeo.com' || !c || !c.request || !c.video) return null;
      const f = c.request.files || {};
      return { href: location.href, id: String(c.video.id), title: c.video.title || '', w: c.video.width, h: c.video.height,
        hls: f.hls ? { url: (f.hls.cdns[f.hls.default_cdn] || Object.values(f.hls.cdns)[0] || {}).url } : null,
        prog: (f.progressive || []).map((p) => ({ url: p.url, w: p.width, h: p.height })) };
    },
  }).catch(() => []);
  return res.map((r) => r.result).filter(Boolean);
}

const text = async (u) => { const r = await fetch(u); if (!r.ok) throw new PerchError(T('Vimeo не отдал видео (') + r.status + ')'); return r.text(); };

async function saveVimeo(tab, cfg, page) {
  const name = cleanName(cfg.title || 'Vimeo ' + cfg.id) + '.mp4';
  const background = /[?&]background=1/.test(cfg.href);
  // an ordinary file, when the owner allows it
  const prog = cfg.prog.filter((p) => p.h <= 1080).sort((a, b) => b.h - a.h)[0];
  if (prog) { await sendBlob((await download(prog.url)).blob, name, page); return name; }
  if (!cfg.hls || !cfg.hls.url) throw new PerchError(T('У этого видео Vimeo нет потока для сохранения'));
  const master = await text(cfg.hls.url);
  if (!background && /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/.test(master)) return saveLink(`https://vimeo.com/${cfg.id}`, cfg.title);
  // the biggest picture up to 1080p
  const lines = master.split(/\r?\n/);
  let best = null;
  lines.forEach((l, i) => {
    const m = l.startsWith('#EXT-X-STREAM-INF') && l.match(/RESOLUTION=(\d+)x(\d+)/);
    if (!m || !lines[i + 1]) return;
    const h = +m[2];
    if (h <= 1080 && (!best || h > best.h)) best = { h, url: new URL(lines[i + 1].trim(), cfg.hls.url).href };
  });
  if (!best) throw new PerchError(T('Не нашёл видеопоток Vimeo'));
  const list = await text(best.url);
  const map = list.match(/#EXT-X-MAP:URI="([^"]+)"/);
  if (!map) throw new PerchError(T('Этот формат потока Vimeo пока не поддерживается'));
  const parts = [map[1], ...list.split(/\r?\n/).filter((l) => l && !l.startsWith('#'))].map((u) => new URL(u.trim(), best.url).href);
  const bufs = [];
  let size = 0;
  for (let i = 0; i < parts.length; i++) {
    const r = await fetch(parts[i]);
    if (!r.ok) throw new PerchError(T('Vimeo оборвал загрузку (') + r.status + ')');
    const b = await r.arrayBuffer();
    bufs.push(b); size += b.byteLength;
    if (size > MAX_VIDEO) throw new PerchError(T('Видео больше 500 МБ — сохраните ссылку'));
    if (i % 3 === 2) await ask(tab, { t: 'toast', text: T('Собираю видео…') + ` ${Math.round((i + 1) / parts.length * 100)}%`, kind: 'busy' });
  }
  await sendBlob(new Blob(bufs, { type: 'video/mp4' }), name, page);
  return name;
}

// one embed: by the frame it was clicked in, or by its iframe address (hover button, the gallery)
async function saveEmbed(tab, frameId, src, page) {
  await ask(tab, { t: 'toast', text: T('Собираю видео…'), kind: 'busy' });
  const id = ((src || '').match(VIMEO_FRAME) || [])[1];
  const cfgs = await vimeoConfigs(tab.id, frameId);
  const cfg = id ? cfgs.find((c) => c.id === id) : cfgs[0];
  if (!cfg) {
    if (id) return saveLink(`https://vimeo.com/${id}`, '');
    throw new PerchError(T('Плеер Vimeo ещё не загрузился — попробуйте через секунду'));
  }
  return saveVimeo(tab, cfg, page || tab.url);
}

// covers and titles of the page's Vimeo embeds, for the «Все картинки страницы» picker
async function embedInfo(ids) {
  return Promise.all(ids.map(async (id) => {
    try {
      const r = await fetch('https://vimeo.com/api/oembed.json?width=1280&url=' + encodeURIComponent('https://vimeo.com/' + id));
      const j = r.ok ? await r.json() : {};
      return { id, thumb: j.thumbnail_url || '', title: j.title || '', w: j.width || 0, h: j.height || 0 };
    } catch (e) { return { id, thumb: '', title: '', w: 0, h: 0 }; }
  }));
}

/* ---------- an article to read in Oddments ---------- */
// The page as the person's own browser shows it (logged in, a paid subscription — the whole article), sent to Oddments as
// <title>.perch-article.html: Oddments takes the readable part (Readability) into «Новости › Сохранённое», not into the
// library. Not a way around paywalls: a page that shows only the beginning gives Oddments only the beginning.
async function saveArticle(tab) {
  const r = await ask(tab, { t: 'pageHtml' });
  if (!r || !r.html) throw new PerchError(T('Страницу не прочитать'));
  const title = cleanName(r.title || tab.title || hostOf(tab.url)).slice(0, 100);
  await sendBlob(new Blob([r.html], { type: 'text/html' }), title + '.perch-article.html', r.url || tab.url);
  return title;
}

/* ---------- «Забрать доску целиком»: Pinterest, Cosmos, Are.na, Savee ---------- */
// What the tab is, from its address only: a board (a Pinterest board or its section, a Cosmos cluster, an Are.na
// channel, a Savee page) or a profile (its boards are offered with checkboxes). Pinterest, Cosmos and Savee are read
// from the page as the person sees it, scrolled by boards.js at a person's pace; Are.na through its official API
// (open channels without a token, closed ones with the person's own token from the popup's settings).
// Everything collected is shown for a last look (what is already in Oddments is unticked), then sent two files at a time.
// Each file carries its collections (Сервис › Доска › Раздел) and its id at the service, so a second run adds only
// what is new — Oddments keeps that id (bridge.js), and deleted files do not come back.
const SKIP = {
  pinterest: /^(pin|search|ideas|today|explore|settings|business|login|signup|password|about|categories|topics|videos|shopping|news_hub|notifications|inbox|homefeed|following|creator-hub|analytics|convert|secure|oauth|resource|edit|offsite|idea-pin-builder|pin-builder|pin-creation-tool)$/i,
  arena: /^(explore|about|blog|editorial|settings|search|notifications|feed|pricing|login|log_in|sign_up|signup|register|block|share|tools|terms|privacy|faq|groups|community|api|developers|oauth|premium|supporters|gift|gifts|support|channels|new|import|reset-password|forgot-password|marks|following|followers|annual-report)$/i,
  cosmos: /^(explore|sequence|login|start|e|settings|shop|home|search|about|privacy|terms|pricing|pro|download|onboarding|notifications|api|blog|careers|discover|signup|invite|saved|legal|help|apps|extension)$/i,
  savee: /^(features|team|upgrade|login|join|mcp|marketplace|course|site|shortcuts|students|faq|contact|terms|privacy|copyright-policy|i|search|settings|explore|pro|discover|api|logout|password|_next)$/i,
};
const pretty = (slug) => { try { return decodeURIComponent(slug || '').replace(/[-_]+/g, ' ').trim(); } catch (e) { return String(slug || ''); } };
export function boardOf(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  const at = (path) => u.origin + '/' + path.join('/') + '/';
  if (/^([a-z]{2,3}\.)?pinterest\.[a-z.]+$/.test(host)) {
    if (!seg.length || SKIP.pinterest.test(seg[0]) || seg[0].startsWith('_')) return null;
    if (seg.length === 1 || (seg.length === 2 && /^_(saved|created|boards|profile)$/.test(seg[1]))) return { service: 'Pinterest', kind: 'profile', user: seg[0], name: '@' + seg[0], url: at([seg[0]]) };
    if (seg[1].startsWith('_') || seg.length > 3) return null;
    return { service: 'Pinterest', kind: 'board', user: seg[0], board: seg[1], section: seg[2] || '', name: pretty(seg[2] || seg[1]), url: at(seg) };
  }
  if (host === 'are.na') {
    if (!seg.length || SKIP.arena.test(seg[0])) return null;
    if (seg.length === 2 && !/^(channels|blocks|followers|following|groups|index|table|about)$/i.test(seg[1])) return { service: 'Are.na', kind: 'board', user: seg[0], board: seg[1], name: pretty(seg[1]), url: u.origin + '/' + seg.join('/') };
    if (seg.length <= 2) return { service: 'Are.na', kind: 'profile', user: seg[0], name: pretty(seg[0]), url: u.origin + '/' + seg[0] };
    return null;
  }
  if (host === 'cosmos.so') {
    if (!seg.length || SKIP.cosmos.test(seg[0])) return null;
    if (seg.length === 1 || (seg.length === 2 && /^(collections|clusters)$/i.test(seg[1]))) return { service: 'Cosmos', kind: 'profile', user: seg[0], name: '@' + seg[0], url: u.origin + '/' + seg[0] + '/collections' };
    if (seg.length === 2) return { service: 'Cosmos', kind: 'board', user: seg[0], board: seg[1], name: pretty(seg[1]), url: u.origin + '/' + seg.join('/') };
    return null;
  }
  if (/^savee\.(com|it)$/.test(host)) {
    if (!seg.length || SKIP.savee.test(seg[0])) return null;
    return { service: 'Savee', kind: 'board', user: seg[0], board: seg.slice(1).join('/'), name: pretty(seg[seg.length - 1]), url: at(seg) };
  }
  return null;
}

let boardJob = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// a tab of the board: the page's own scripts are there after every load (content.js by the manifest, boards.js here)
async function boardsIn(tab) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['i18n.js', 'content.js', 'block.js', 'boards.js'] }).catch(() => {});
}
async function goTo(tab, url) {
  const loaded = new Promise((res) => {
    const on = (id, info) => { if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(on); res(); } };
    chrome.tabs.onUpdated.addListener(on);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); res(); }, 30000);
  });
  await chrome.tabs.update(tab.id, { url });
  await loaded;
  await wait(1800); // the site's own script draws the grid after the load
  await boardsIn(tab);
}
const sameUrl = (a, b) => String(a || '').replace(/[?#].*$/, '').replace(/\/+$/, '') === String(b || '').replace(/[?#].*$/, '').replace(/\/+$/, '');

async function grabBoards(tab) {
  if (boardJob) { await say(tab, T('Доска уже забирается — дождитесь конца или нажмите «Остановить»'), 'err'); return null; }
  const where = boardOf(tab.url);
  if (!where) throw new PerchError(T('Здесь нет доски: откройте доску Pinterest, кластер Cosmos, канал Are.na или доску Savee'));
  // Oddments must be there before minutes of scrolling, not after
  const st = await status();
  if (st.state === 'off') throw new PerchError(T('Oddments не запущен: откройте приложение'), true);
  if (st.state !== 'ok') throw new PerchError(T('Нет токена: вставьте его в окне расширения'), true);
  boardJob = { stop: false, tab: tab.id };
  // the worker sleeps after 30 s without the extension's own calls: a long walk keeps it awake
  const keep = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  try {
    await boardsIn(tab);
    const groups = where.service === 'Are.na' ? await arenaGroups(tab, where) : await pageGroups(tab, where);
    await ask(tab, { t: 'boardProgress', done: true });
    if (!groups) return null;
    const all = groups.reduce((n, g) => n + g.items.length, 0);
    if (!all) throw new PerchError(T('На доске не нашлось картинок и видео'));
    const known = ((await status()).catalog || {}).boards || [];
    const picked = await ask(tab, { t: 'boardReview', groups, known });
    if (!picked || !picked.length) return null;
    return await sendBoard(tab, picked, groups.reduce((n, g) => n + (g.skipped || 0), 0));
  } finally { clearInterval(keep); boardJob = null; }
}

// Pinterest, Cosmos, Savee: the boards are visited in this tab one by one; a Pinterest board's sections after it
async function pageGroups(tab, where) {
  let boards = [{ url: where.url, path: null }];
  if (where.kind === 'profile') {
    if (where.service === 'Cosmos' && !sameUrl(tab.url, where.url)) await goTo(tab, where.url);
    const list = await ask(tab, { t: 'boardList', where });
    if (!list || !list.length) throw new PerchError(T('На странице профиля не нашлось досок'));
    const chosen = await ask(tab, { t: 'boardChoose', where, boards: list });
    if (!chosen || !chosen.length) return null;
    boards = chosen.map((b) => ({ url: b.url, path: null }));
  }
  const groups = [];
  for (let i = 0; i < boards.length && !boardJob.stop; i++) {
    const b = boards[i];
    const cur = await chrome.tabs.get(tab.id).catch(() => null);
    if (!cur) break; // the tab was closed
    if (!sameUrl(cur.url, b.url)) await goTo(tab, b.url);
    const r = await ask(tab, { t: 'boardCollect', where: boardOf(b.url), parent: b.path, step: i + 1, steps: boards.length });
    if (!r) continue;
    groups.push({ name: r.name, path: r.path, items: r.items, skipped: r.skipped || 0, expect: r.expect || 0 });
    for (const s of r.sections || []) boards.push({ url: s.url, path: r.path });
  }
  // a pin that is both on the board and in its section belongs to the section (the later, deeper group)
  const owner = new Map();
  for (const g of groups) for (const it of g.items) owner.set(it.src, g);
  for (const g of groups) g.items = g.items.filter((it) => owner.get(it.src) === g);
  return groups.filter((g) => g.items.length);
}

// Are.na: the official API (api.are.na/v3), paced under its limits (30 requests a minute without a token). The requests
// go from the Are.na page itself (boards.js arenaApi): the API turns an extension's own origin away.
async function arenaGroups(tab, where) {
  const tok = ((await chrome.storage.local.get('arenaToken')).arenaToken || '').trim();
  const gap = tok ? 700 : 2100;
  let last = 0;
  const api = async (path) => {
    for (let tries = 0; ; tries++) {
      const pause = last + gap - Date.now();
      if (pause > 0) await wait(pause);
      last = Date.now();
      const r = (await ask(tab, { t: 'arenaApi', path, token: tok })) || { status: 0 };
      if (r.status === 429 && tries < 3) { await wait(30000); continue; }
      if (r.status === 401 || r.status === 403) throw new PerchError(tok ? T('Are.na не принял токен — проверьте его в настройках расширения') : T('Это закрытый канал: вставьте свой токен Are.na в настройках расширения'));
      if (r.status === 404) return null;
      if (r.status !== 200 || !r.json) throw new PerchError(T('Are.na ответил ') + (r.status || r.error || '?'));
      return r.json;
    }
  };
  const pages = async (path, onPage) => {
    const out = [];
    for (let page = 1; page < 200 && !boardJob.stop; page++) {
      const j = await api(path + (path.includes('?') ? '&' : '?') + 'per=100&page=' + page);
      if (!j) return page === 1 ? null : out;
      out.push(...(j.data || []));
      if (onPage) await onPage(out.length, (j.meta && j.meta.total_count) || 0);
      if (!(j.meta && j.meta.has_more_pages)) break;
    }
    return out;
  };
  let channels = [{ slug: where.board, title: where.name }];
  if (where.kind === 'profile') {
    await ask(tab, { t: 'boardProgress', text: T('Are.na: читаю каналы…') });
    const list = (await pages(`/users/${encodeURIComponent(where.user)}/contents?type=Channel`)) || (await pages(`/groups/${encodeURIComponent(where.user)}/contents?type=Channel`)) || [];
    const boards = list.filter((c) => c.type === 'Channel').map((c) => ({
      url: `https://www.are.na/${(c.owner && c.owner.slug) || where.user}/${c.slug}`, name: c.title, count: (c.counts && c.counts.contents) || 0, slug: c.slug }));
    await ask(tab, { t: 'boardProgress', done: true });
    if (!boards.length) throw new PerchError(T('У этого профиля Are.na нет открытых каналов'));
    const chosen = await ask(tab, { t: 'boardChoose', where, boards });
    if (!chosen || !chosen.length) return null;
    channels = chosen.map((c) => ({ slug: c.slug || c.url.split('/').pop(), title: c.name }));
  }
  const groups = [];
  for (let i = 0; i < channels.length && !boardJob.stop; i++) {
    const c = channels[i];
    const info = await api(`/channels/${encodeURIComponent(c.slug)}`);
    if (!info) throw new PerchError(tok ? T('Канал Are.na не нашёлся') : T('Канал Are.na не открылся: если он закрытый, вставьте свой токен Are.na в настройках расширения'));
    const title = info.title || c.title || pretty(c.slug);
    const path = [['arena', 'Are.na'], ['arena:channel:' + info.id, title]];
    const blocks = await pages(`/channels/${encodeURIComponent(c.slug)}/contents`, (n, all) =>
      ask(tab, { t: 'boardProgress', text: T('Are.na · {name}: {n} из {all}', { name: title, n, all: all || n }), n, all, step: i + 1, steps: channels.length }));
    const items = [];
    let skipped = 0;
    for (const b of blocks || []) {
      const it = arenaItem(b);
      if (it) items.push({ ...it, path }); else skipped++;
    }
    groups.push({ name: title, path, items, skipped });
  }
  return groups;
}
// an Are.na block as a file to send: pictures and attachments as files, links and embeds as link cards; text blocks
// and channels inside the channel are counted and left
export function arenaItem(b) {
  const src = 'arena:block:' + b.id;
  const note = (b.description && b.description.plain) || '';
  const page = `https://www.are.na/block/${b.id}`;
  const thumb = b.image ? ((b.image.small && b.image.small.src) || (b.image.medium && b.image.medium.src) || b.image.src) : '';
  const size = b.image ? { w: b.image.width || 0, h: b.image.height || 0 } : {};
  if (b.type === 'Image' && b.image && b.image.src) return { kind: 'file', url: b.image.src, name: b.title || b.image.filename || 'Are.na ' + b.id, note, link: (b.source && b.source.url) || page, src, thumb, ...size };
  if (b.type === 'Attachment' && b.attachment && b.attachment.url) return { kind: 'file', url: b.attachment.url, name: b.attachment.filename || b.title || 'Are.na ' + b.id, note, link: page, src, thumb, file: true };
  const href = b.type === 'Link' ? b.source && b.source.url : b.type === 'Embed' ? (b.embed && (b.embed.source_url || b.embed.url)) || (b.source && b.source.url) : '';
  if (href && /^https?:/i.test(href)) return { kind: 'link', url: href, name: b.title || (b.source && b.source.title) || hostOf(href), note, link: href, src, thumb, ...size };
  return null;
}

// the files, two at a time; a fatal error (Oddments closed, the token) stops the rest
async function sendBoard(tab, items, skipped) {
  let ok = 0, bad = 0;
  const total = items.length;
  const queue = items.slice();
  const show = () => ask(tab, { t: 'toast', text: T('В Oddments: {n} из {all}…', { n: ok + bad, all: total }), kind: 'busy' });
  await show();
  const worker = async () => {
    for (let it; (it = queue.shift());) {
      if (boardJob && boardJob.stop) { queue.length = 0; break; }
      try { await sendBoardItem(it); ok++; } catch (e) { bad++; if (e instanceof PerchError && e.fatal) { queue.length = 0; throw e; } }
      if ((ok + bad) % 3 === 0 || !queue.length) await show();
    }
  };
  try { await Promise.all([worker(), worker()]); } catch (e) { await failed(tab, e); return null; }
  const parts = [T('В Oddments: ') + ok];
  if (bad) parts.push(T('не скачалось: ') + bad);
  if (skipped) parts.push(T('без текстовых блоков и вложенных каналов: ') + skipped);
  await say(tab, parts.join(' · '), bad && !ok ? 'err' : 'ok');
  return null;
}
// the board's JSON goes in `folder`; the receiver reads one line of at most 8 KB, so a long description is cut
export function boardFolderParam(it) {
  let note = (it.note || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  for (;;) {
    const json = JSON.stringify({ path: it.path, src: it.src, ...(note ? { note } : {}) });
    if (encodeURIComponent(json).length + encodeURIComponent(it.name || '').length + encodeURIComponent(it.link || '').length < 6000 || !note) return json;
    note = note.slice(0, Math.floor(note.length * 0.6));
  }
}
async function sendBoardItem(it) {
  const folder = boardFolderParam(it);
  const base = cleanName(it.name || 'image').slice(0, 100);
  const link = /^https?:/i.test(it.link || '') ? it.link : '';
  if (it.kind === 'link') return sendBlob(shortcut(it.url), base + '.url', link || it.url, null, folder);
  if (it.kind === 'hls') {
    try { return await sendBlob(new Blob([await pinterestHls(it.hls, (u) => fetch(u))], { type: 'video/mp4' }), base + '.mp4', link, null, folder); } catch (e) {
      if (e instanceof PerchError && e.fatal) throw e;
      if (!it.url) throw e; // no cover to fall back to
    }
  }
  // the original first, smaller copies if it is not there (a Pinterest original may be PNG under a .jpg name)
  let got = null, last = null;
  for (const u of [it.url, ...(it.alt || [])].filter(Boolean)) {
    try { got = await download(u); if (got.type !== 'text/html' && got.blob.size) break; got = null; } catch (e) { last = e; }
  }
  if (!got) throw last || new PerchError(T('Сайт не отдал файл'));
  const own = (nameFromUrl(it.url).match(/\.([a-z0-9]{1,5})$/i) || [])[1] || '';
  const real = EXT[got.type] || own || 'jpg';
  // an attachment keeps its own name and extension; a picture gets the extension of what the site really sent
  const name = it.file && own ? base.replace(/\.[a-z0-9]{1,5}$/i, '') + '.' + own.toLowerCase() : base.replace(/\.[a-z0-9]{1,5}$/i, '') + '.' + real.toLowerCase();
  return sendBlob(got.blob, name, link, null, folder);
}

/* ---------- menus, keys, messages ---------- */
// the right-click menu, grouped the way the popup is: what is under the pointer, the page, «Снять», «Забрать»
const PIN_HOSTS = ['com', 'ru', 'de', 'fr', 'co.uk', 'ca', 'es', 'it', 'jp', 'com.au', 'com.mx', 'at', 'ch', 'nz', 'ie', 'pt', 'se', 'dk', 'cl', 'ph', 'co.kr', 'nl', 'pl', 'cz'];
const BOARD_SITES = [...PIN_HOSTS.map((d) => `*://*.pinterest.${d}/*`), '*://*.are.na/*', '*://*.cosmos.so/*', '*://*.savee.com/*', '*://*.savee.it/*'];
const MENUS = [
  { id: 'img', title: 'Картинку в Oddments', contexts: ['image'] },
  { id: 'video', title: 'Видео в Oddments', contexts: ['video'] },
  { id: 'link', title: 'Ссылку в Oddments', contexts: ['link'] },
  // inside a Vimeo player frame (Behance animations): the video itself
  { id: 'embed', title: 'Это видео в Oddments', contexts: ['page', 'frame', 'video', 'image', 'link'], documentUrlPatterns: ['https://player.vimeo.com/video/*'] },
  { id: 'page', title: 'Страницу закладкой', contexts: ['page', 'selection'] },
  { id: 'article', title: 'Страницу текстом для чтения', contexts: ['page', 'selection'] },
  { id: 'sep1', type: 'separator', contexts: ['page', 'image', 'link', 'video', 'selection'] },
  { id: 'area', title: 'Снимок области', contexts: ['page', 'image', 'link', 'video', 'selection'] },
  { id: 'shot', title: 'Снимок всего, что видно', contexts: ['page', 'image', 'link', 'video', 'selection'] },
  { id: 'rec', title: 'Видео области', contexts: ['page', 'image', 'link', 'video', 'selection'] },
  { id: 'sep2', type: 'separator', contexts: ['page', 'image', 'link', 'video', 'selection'] },
  { id: 'all', title: 'Все картинки страницы…', contexts: ['page', 'image', 'link', 'video'] },
  { id: 'block', title: 'Кусок вёрстки: картинка и код…', contexts: ['page', 'image', 'link', 'video', 'selection'] },
  { id: 'board', title: 'Забрать доску целиком…', contexts: ['page', 'image', 'link', 'video'], documentUrlPatterns: BOARD_SITES },
];

/* ---------- a block of a page's layout (block.js) ---------- */
// the window's picture for the block's shot, one at a time and not faster than Chrome allows (two a second)
let lastShot = 0;
async function captureFor(tab) {
  const gap = 560 - (Date.now() - lastShot);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastShot = Date.now();
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
}
// the @font-face rules of the block's families, with the font files inside (Oddments shows only fonts it carries):
// the rules the page could read itself plus the ones in other sites' sheets (Google Fonts…), read here without CORS
const FACE = /@font-face\s*{[^}]*}/gi;
async function blockFonts(faces, far, want) {
  const wanted = new Set(want || []);
  const all = [...(faces || [])];
  for (const href of far || []) {
    try {
      const css = await (await fetch(href)).text();
      for (const f of css.match(FACE) || []) {
        const fam = ((f.match(/font-family\s*:\s*([^;]+)/i) || [])[1] || '').replace(/["']/g, '').trim().toLowerCase();
        if (wanted.has(fam)) all.push(f.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (m, u) => `url("${new URL(u, href).href}")`));
      }
    } catch (e) { /* that sheet is not reachable */ }
  }
  let budget = 4e6;
  const out = [];
  for (const f of all.slice(0, 24)) {
    const urls = [...f.matchAll(/url\("?([^")]+)"?\)\s*(?:format\(["']?([\w-]+)["']?\))?/g)].map((m) => ({ u: m[1], fmt: (m[2] || '').toLowerCase() }));
    const pick = urls.find((x) => x.fmt === 'woff2' || /\.woff2(\?|$)/i.test(x.u)) || urls.find((x) => /^https?:/.test(x.u));
    if (!pick || budget <= 0) continue;
    try {
      const b = await (await fetch(pick.u)).arrayBuffer();
      if (b.byteLength > budget) continue;
      budget -= b.byteLength;
      let s = '';
      const u8 = new Uint8Array(b);
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      const type = pick.fmt === 'woff2' || /\.woff2/i.test(pick.u) ? 'font/woff2' : /\.woff(\?|$)/i.test(pick.u) ? 'font/woff' : 'font/ttf';
      out.push(f.replace(/src\s*:[^;}]+/i, `src:url(data:${type};base64,${btoa(s)})`));
    } catch (e) { /* that font file is not reachable */ }
  }
  return out.join('\n');
}
async function saveBlock(tab, msg) {
  const bin = atob(msg.data), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const name = cleanName(msg.name || T('Блок')) + '.oddblock';
  await sendBlob(new Blob([u8], { type: 'application/x-oddments-block' }), name, msg.page || (tab && tab.url), msg.tags);
  return cleanName(msg.name || T('Блок'));
}
async function makeMenus() {
  await globalThis.oddLangReady;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'perch', title: 'Oddments', contexts: ['page', 'frame', 'image', 'link', 'video', 'selection'] });
    for (const m of MENUS) chrome.contextMenus.create({ ...m, ...(m.title ? { title: T(m.title) } : {}), parentId: 'perch' });
  });
}
// the language chosen in the popup: the menus follow at once
chrome.storage.onChanged.addListener((ch) => { if (ch.lang || ch.appLang) setTimeout(makeMenus, 0); });
chrome.runtime.onInstalled.addListener(makeMenus);
// «Как пользоваться» opens once: after the install, and after the update to 1.7 (the version that brought it)
chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  const seen = (await chrome.storage.local.get('helpSeen')).helpSeen;
  const old = reason === 'update' && /^1\.[0-6](\.|$)/.test(previousVersion || '');
  if (seen || (reason !== 'install' && !old)) return;
  await chrome.storage.local.set({ helpSeen: chrome.runtime.getManifest().version });
  chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
});
chrome.runtime.onStartup.addListener(makeMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const page = info.pageUrl || (tab && tab.url) || '';
  // a right click inside an embedded Vimeo player saves its video, whatever item was chosen
  if (VIMEO_FRAME.test(info.frameUrl || '') && ['embed', 'page', 'video'].includes(info.menuItemId)) {
    return run(tab, () => saveEmbed(tab, info.frameId, info.frameUrl, page), (n) => T('В Oddments: ') + n);
  }
  switch (info.menuItemId) {
    case 'img': return run(tab, async () => {
      // blob: pictures live only inside the page: the page script reads them
      if (/^blob:/i.test(info.srcUrl)) { const r = await ask(tab, { t: 'readBlob', url: info.srcUrl }); if (!r || !r.data) throw new PerchError(T('Картинку не прочитать')); return saveFile(r.data, page, tab.title); }
      const best = await ask(tab, { t: 'best', url: info.srcUrl });
      return saveFile((best && best.url) || info.srcUrl, page, tab.title);
    }, (n) => T('В Oddments: ') + n);
    case 'video': return run(tab, async () => {
      const v = videoOf(page);
      if (v || !info.srcUrl || /^blob:/i.test(info.srcUrl)) return saveLink(v ? v.url : page, tab.title, tab);
      return saveFile(info.srcUrl, page, tab.title);
    }, (n) => T('В Oddments: ') + n);
    case 'link': return run(tab, () => (KNOWN.test(nameFromUrl(info.linkUrl)) ? saveFile(info.linkUrl, page) : saveLink(info.linkUrl, info.selectionText || info.linkText || '')), (n) => T('В Oddments: ') + n);
    case 'page': return run(tab, () => saveLink(page, tab.title, tab), (n) => T('В Oddments: ') + n);
    case 'article': return run(tab, () => saveArticle(tab), (n) => T('Статья в Oddments: ') + n);
    case 'all': return ask(tab, { t: 'gallery' });
    case 'area': return run(tab, () => shotArea(tab), (n) => T('В Oddments: ') + n);
    case 'rec': return run(tab, () => recordArea(tab), (n) => n);
    case 'shot': return run(tab, () => shotVisible(tab), (n) => T('В Oddments: ') + n);
    case 'block': return ask(tab, { t: 'pickBlock' });
    case 'board': return run(tab, () => grabBoards(tab), (n) => n);
  }
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;
  if (cmd === 'shot-visible') run(tab, () => shotVisible(tab), (n) => T('В Oddments: ') + n);
  if (cmd === 'shot-area') run(tab, () => shotArea(tab), (n) => T('В Oddments: ') + n);
  if (cmd === 'save-all') ask(tab, { t: 'gallery' });
  if (cmd === 'save-article') run(tab, () => saveArticle(tab), (n) => T('Статья в Oddments: ') + n);
  if (cmd === 'grab-block') ask(tab, { t: 'pickBlock' });
  if (cmd === 'record-area') run(tab, () => recordArea(tab), (n) => n);
  if (cmd === 'save-page') run(tab, () => saveLink(tab.url, tab.title, tab), (n) => T('В Oddments: ') + n);
  if (cmd === 'grab-board') run(tab, () => grabBoards(tab), (n) => n);
});

// the browser's own page for the keys: Chrome and Edge by address, Firefox and Zen by their API (137+)
async function openShortcuts() {
  if (chrome.commands.openShortcutSettings) return chrome.commands.openShortcutSettings();
  const edge = /Edg\//.test(navigator.userAgent);
  return chrome.tabs.create({ url: edge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tab = sender.tab;
  (async () => {
    switch (msg.t) {
      case 'status': return status();
      case 'prefs': return prefs();
      case 'saveFile': return run(tab, () => saveFile(msg.url, msg.page || (tab && tab.url), msg.alt, msg.name), (n) => T('В Oddments: ') + n);
      case 'saveLink': return run(tab, () => saveLink(msg.url, msg.title, tab), (n) => T('В Oddments: ') + n);
      // «Забрать блок» (block.js): the window's picture for its shot, its fonts, the finished file
      case 'blockCapture': try { return { data: await captureFor(tab) }; } catch (e) { return { error: (e && e.message) || String(e) }; }
      case 'blockFonts': return { css: await blockFonts(msg.faces, msg.far, msg.want).catch(() => '') };
      case 'saveBlock': return run(tab, () => saveBlock(tab, msg), (n) => T('Блок в Oddments: ') + n);
      // a video played as a stream (Instagram not signed in): its whole video track, joined with the audio track
      case 'saveStream': return run(tab, async () => {
        const vid = new Uint8Array(await (await download(msg.video)).blob.arrayBuffer());
        let out = vid;
        if (msg.audio) {
          try { out = muxAV(vid, new Uint8Array(await (await download(msg.audio)).blob.arrayBuffer())); } catch (e) { out = vid; }
        }
        const name = cleanName(msg.title || T('Видео')) + '.mp4';
        await sendBlob(new Blob([out], { type: 'video/mp4' }), name, msg.page || (tab && tab.url));
        return name;
      }, (n) => T('В Oddments: ') + n);
      // a Pinterest video: its stream's video and audio joined into one MP4 (fmp4.js); no stream — the pin as a link
      case 'savePinVideo': return run(tab, async () => {
        const page = msg.pin || (tab && tab.url) || '';
        try {
          const mp4 = await pinterestHls(msg.hls, (u) => fetch(u));
          const name = cleanName(msg.title || 'Pinterest') + '.mp4';
          await sendBlob(new Blob([mp4], { type: 'video/mp4' }), name, page);
          return name;
        } catch (e) {
          if (e instanceof PerchError || !msg.pin) throw e;
          return saveLink(msg.pin, msg.title);
        }
      }, (n) => T('В Oddments: ') + n);
      case 'saveMany': return saveMany(tab, msg.items);
      // a video without a file (Instagram reels and the like, Media Source): its current frame + a link card to the post
      case 'saveFrame': return run(tab, async () => {
        const blob = await (await fetch(msg.data)).blob();
        await sendBlob(blob, cleanName(msg.title || T('Кадр')) + T(' — кадр.png'), msg.link || (tab && tab.url));
        if (/^https?:/i.test(msg.link || '')) await saveLink(msg.link, msg.title);
        return cleanName(msg.title || T('кадр'));
      }, (n) => T('В Oddments: ') + n);
      // the same video recorded while it played (Alt+Shift+click): a WebM file
      case 'saveRecording': return run(tab, async () => {
        const blob = await (await fetch(msg.data)).blob();
        const name = cleanName(msg.title || T('Видео')) + '.webm';
        await sendBlob(blob, name, msg.link || (tab && tab.url));
        return name;
      }, (n) => T('В Oddments: ') + n);
      // Alt+click inside a Vimeo frame (embed.js), or the hover button over its iframe (content.js)
      case 'saveEmbed': return run(tab, () => saveEmbed(tab, msg.src ? null : sender.frameId, msg.src || (sender.url || ''), tab && tab.url), (n) => T('В Oddments: ') + n);
      case 'embedInfo': return embedInfo(msg.ids || []);
      // «Видео области»: the bar on the page (pause, resume, stop, cancel) and the finished file from offscreen.js
      case 'recCtl': return toOff({ t: 'recCtl', do: msg.do }).catch(() => ({ on: false }));
      case 'recDone': return recordingDone(msg);
      // Zen, Firefox: the page recorded it (content.js recLocal) and hands over the file itself
      case 'recFile': return recordingDone({ ...msg, url: URL.createObjectURL(msg.blob), size: msg.blob.size, type: msg.blob.type, tabId: tab && tab.id });
      case 'boardHere': { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t ? boardOf(t.url) : null; }
      case 'boardStop': if (boardJob) boardJob.stop = true; return true;
      case 'openShortcuts': return openShortcuts();
      // from the popup: act on the active tab
      case 'popup': {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!t) return;
        if (msg.do === 'shot') return run(t, () => shotVisible(t), (n) => T('В Oddments: ') + n);
        if (msg.do === 'area') return run(t, () => shotArea(t), (n) => T('В Oddments: ') + n);
        if (msg.do === 'rec') return run(t, () => recordArea(t), (n) => n);
        if (msg.do === 'page') return run(t, () => saveLink(t.url, t.title), (n) => T('В Oddments: ') + n);
        if (msg.do === 'all') return ask(t, { t: 'gallery' });
        if (msg.do === 'article') return run(t, () => saveArticle(t), (n) => T('Статья в Oddments: ') + n);
        if (msg.do === 'block') return ask(t, { t: 'pickBlock' });
        if (msg.do === 'board') return run(t, () => grabBoards(t), (n) => n);
      }
    }
  })().then(reply, () => reply(undefined));
  return true; // the answer comes later
});
