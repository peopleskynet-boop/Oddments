// Oddments for Chrome and Edge: the service worker. Everything goes to the Oddments window on this computer
// through its local receiver (127.0.0.1, ports 47215–47219, the token from Oddments › Настройки › Интеграции):
//   POST /import?name&source&token&folder&tags — one file; the folder and tags chosen in the popup go along.
//   GET  /library?token — folders and tags for the popup's picker.
// Pictures are downloaded here (host permissions: no CORS), so the page's own scripts never see the token.

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

class PerchError extends Error {}
async function endpoint(path, params = {}) {
  const p = await prefs();
  const at = await findPerch();
  if (!at) throw new PerchError('Oddments не запущен: откройте приложение');
  if (!p.token) throw new PerchError('Нет токена: вставьте его в окне расширения');
  const q = new URLSearchParams({ ...params, token: p.token });
  return { url: `http://127.0.0.1:${at}${path}?${q}`, p };
}

async function sendBlob(blob, name, source, tags) {
  const { url } = await endpoint('/import', await target({ name: cleanName(name), source: source || '' }, tags));
  let r;
  try { r = await fetch(url, { method: 'POST', body: blob }); } catch (e) { port = null; throw new PerchError('Oddments не ответил'); }
  if (r.status === 401) throw new PerchError('Токен не подошёл: скопируйте его заново в Oddments › Настройки');
  if (!r.ok) throw new PerchError('Oddments ответил ' + r.status);
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
    return { state: 'ok', catalog: await r.json() };
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
  if (!r.ok) throw new PerchError('Сайт не отдал файл (' + r.status + ')');
  const blob = await r.blob();
  const type = (r.headers.get('content-type') || blob.type || '').split(';')[0].trim();
  return { blob, type };
}

// a picture or a video file by URL; `hint` names it when the URL does not
async function saveFile(url, page, hint, named) {
  if (/^blob:/i.test(url)) throw new PerchError('Это поток из скрипта страницы, сохранить его нельзя');
  const { blob, type } = await download(url);
  if (type === 'text/html') throw new PerchError('По ссылке страница, а не файл');
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

const shortcut = (url) => new Blob([`[InternetShortcut]\r\nURL=${url}\r\n`], { type: 'application/x-url' });
const videoOf = (u) => { for (const v of VIDEO_URLS) { const m = (u || '').match(v.re); if (m) return { url: m[0], site: v.site, id: m[1] }; } return null; };

async function videoTitle(v) {
  const api = v.site === 'YouTube' ? 'https://www.youtube.com/oembed?format=json&url=' : v.site === 'Vimeo' ? 'https://vimeo.com/api/oembed.json?url=' : '';
  if (!api) return '';
  try { const r = await fetch(api + encodeURIComponent(v.url)); return r.ok ? ((await r.json()).title || '').trim() : ''; } catch (e) { return ''; }
}

// a link card: YouTube / Vimeo / Pinterest get their cover in Oddments, any other page a link card
async function saveLink(url, title) {
  // only web addresses: a javascript:, file: or search-ms: link would become a .url that Windows hands to its handler
  if (!/^https?:\/\//i.test(url || '')) throw new PerchError('Сохраняются только веб-ссылки (http/https)');
  const v = videoOf(url);
  if (v) title = (await videoTitle(v)) || title || `${v.site} ${v.id}`;
  title = cleanName((title || '').replace(/\s+[-–—|]\s+(YouTube|Vimeo|Pinterest)$/i, '') || hostOf(url));
  await sendBlob(shortcut(v ? v.url : url), title + '.url', url);
  return title;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'Ссылка'; } };

/* ---------- screenshots ---------- */
async function shotVisible(tab) {
  const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const blob = await (await fetch(data)).blob();
  const name = `Снимок ${hostOf(tab.url)} ${stamp()}.png`;
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
  const name = `Снимок ${hostOf(tab.url)} ${stamp()}.png`;
  await sendBlob(blob, name, tab.url);
  return name;
}

/* ---------- the page side ---------- */
// a message to the tab's content script; scripts that were not there yet (tabs opened before the install) are injected
async function ask(tab, msg) {
  try { return await chrome.tabs.sendMessage(tab.id, msg); } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js', 'block.js'] });
      return await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e2) { return undefined; }
  }
}
async function say(tab, text, kind = 'ok') {
  if (tab && tab.id != null && (await ask(tab, { t: 'toast', text, kind })) !== undefined) return;
  // pages without the script (chrome://, the web store): the badge says it
  chrome.action.setBadgeBackgroundColor({ color: kind === 'err' ? '#ff2d6f' : '#c6ff00' });
  chrome.action.setBadgeText({ text: kind === 'err' ? '!' : '✓' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}
const failed = (tab, e) => say(tab, e instanceof PerchError ? e.message : 'Не получилось: ' + ((e && e.message) || e), 'err');
async function run(tab, job, okText) {
  try { const r = await job(); if (r !== null) await say(tab, okText(r)); } catch (e) { await failed(tab, e); }
}

async function saveMany(tab, items) {
  let ok = 0, bad = 0;
  await ask(tab, { t: 'toast', text: `В Oddments: 0 из ${items.length}…`, kind: 'busy' });
  // three at a time: fast, but no flood on the site or on Oddments
  const queue = items.slice();
  const worker = async () => {
    for (let it; (it = queue.shift());) {
      try { if (it.embed) await saveEmbed(tab, null, it.embed, tab.url); else await saveFile(it.url, tab.url, it.alt); ok++; } catch (e) { bad++; if (e instanceof PerchError && /Oddments|Токен|токен/.test(e.message)) { queue.length = 0; throw e; } }
      await ask(tab, { t: 'toast', text: `В Oddments: ${ok} из ${items.length}…`, kind: 'busy' });
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); } catch (e) { return failed(tab, e); }
  await say(tab, `В Oddments: ${ok}` + (bad ? ` · не скачалось: ${bad}` : ''), bad && !ok ? 'err' : 'ok');
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

const text = async (u) => { const r = await fetch(u); if (!r.ok) throw new PerchError('Vimeo не отдал видео (' + r.status + ')'); return r.text(); };

async function saveVimeo(tab, cfg, page) {
  const name = cleanName(cfg.title || 'Vimeo ' + cfg.id) + '.mp4';
  const background = /[?&]background=1/.test(cfg.href);
  // an ordinary file, when the owner allows it
  const prog = cfg.prog.filter((p) => p.h <= 1080).sort((a, b) => b.h - a.h)[0];
  if (prog) { await sendBlob((await download(prog.url)).blob, name, page); return name; }
  if (!cfg.hls || !cfg.hls.url) throw new PerchError('У этого видео Vimeo нет потока для сохранения');
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
  if (!best) throw new PerchError('Не нашёл видеопоток Vimeo');
  const list = await text(best.url);
  const map = list.match(/#EXT-X-MAP:URI="([^"]+)"/);
  if (!map) throw new PerchError('Этот формат потока Vimeo пока не поддерживается');
  const parts = [map[1], ...list.split(/\r?\n/).filter((l) => l && !l.startsWith('#'))].map((u) => new URL(u.trim(), best.url).href);
  const bufs = [];
  let size = 0;
  for (let i = 0; i < parts.length; i++) {
    const r = await fetch(parts[i]);
    if (!r.ok) throw new PerchError('Vimeo оборвал загрузку (' + r.status + ')');
    const b = await r.arrayBuffer();
    bufs.push(b); size += b.byteLength;
    if (size > MAX_VIDEO) throw new PerchError('Видео больше 500 МБ — сохраните ссылку');
    if (i % 3 === 2) await ask(tab, { t: 'toast', text: `Собираю видео… ${Math.round((i + 1) / parts.length * 100)}%`, kind: 'busy' });
  }
  await sendBlob(new Blob(bufs, { type: 'video/mp4' }), name, page);
  return name;
}

// one embed: by the frame it was clicked in, or by its iframe address (hover button, the gallery)
async function saveEmbed(tab, frameId, src, page) {
  await ask(tab, { t: 'toast', text: 'Собираю видео…', kind: 'busy' });
  const id = ((src || '').match(VIMEO_FRAME) || [])[1];
  const cfgs = await vimeoConfigs(tab.id, frameId);
  const cfg = id ? cfgs.find((c) => c.id === id) : cfgs[0];
  if (!cfg) {
    if (id) return saveLink(`https://vimeo.com/${id}`, '');
    throw new PerchError('Плеер Vimeo ещё не загрузился — попробуйте через секунду');
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
  if (!r || !r.html) throw new PerchError('Страницу не прочитать');
  const title = cleanName(r.title || tab.title || hostOf(tab.url)).slice(0, 100);
  await sendBlob(new Blob([r.html], { type: 'text/html' }), title + '.perch-article.html', r.url || tab.url);
  return title;
}

/* ---------- menus, keys, messages ---------- */
const MENUS = [
  { id: 'img', title: 'Сохранить картинку в Oddments', contexts: ['image'] },
  { id: 'video', title: 'Сохранить видео в Oddments', contexts: ['video'] },
  { id: 'link', title: 'Сохранить ссылку в Oddments', contexts: ['link'] },
  { id: 'page', title: 'Сохранить страницу в Oddments', contexts: ['page', 'selection'] },
  { id: 'article', title: 'Сохранить статью в Oddments — читать там', contexts: ['page', 'selection'] },
  // inside a Vimeo player frame (Behance animations): the video itself
  { id: 'embed', title: 'Сохранить это видео в Oddments', contexts: ['page', 'frame', 'video', 'image', 'link'], documentUrlPatterns: ['https://player.vimeo.com/video/*'] },
  { id: 'sep', type: 'separator', contexts: ['page', 'image', 'link', 'video'] },
  { id: 'all', title: 'Все картинки страницы…', contexts: ['page', 'image', 'link'] },
  { id: 'area', title: 'Снимок области', contexts: ['page', 'image', 'link', 'video'] },
  { id: 'shot', title: 'Снимок видимой части', contexts: ['page', 'image', 'link', 'video'] },
  { id: 'block', title: 'Забрать блок интерфейса…', contexts: ['page', 'image', 'link', 'video', 'selection'] },
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
  const name = cleanName(msg.name || 'Блок') + '.oddblock';
  await sendBlob(new Blob([u8], { type: 'application/x-oddments-block' }), name, msg.page || (tab && tab.url), msg.tags);
  return cleanName(msg.name || 'Блок');
}
function makeMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'perch', title: 'Oddments', contexts: ['page', 'frame', 'image', 'link', 'video', 'selection'] });
    for (const m of MENUS) chrome.contextMenus.create({ ...m, parentId: 'perch' });
  });
}
chrome.runtime.onInstalled.addListener(makeMenus);
chrome.runtime.onStartup.addListener(makeMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const page = info.pageUrl || (tab && tab.url) || '';
  // a right click inside an embedded Vimeo player saves its video, whatever item was chosen
  if (VIMEO_FRAME.test(info.frameUrl || '') && ['embed', 'page', 'video'].includes(info.menuItemId)) {
    return run(tab, () => saveEmbed(tab, info.frameId, info.frameUrl, page), (n) => 'В Oddments: ' + n);
  }
  switch (info.menuItemId) {
    case 'img': return run(tab, async () => {
      // blob: pictures live only inside the page: the page script reads them
      if (/^blob:/i.test(info.srcUrl)) { const r = await ask(tab, { t: 'readBlob', url: info.srcUrl }); if (!r || !r.data) throw new PerchError('Картинку не прочитать'); return saveFile(r.data, page, tab.title); }
      const best = await ask(tab, { t: 'best', url: info.srcUrl });
      return saveFile((best && best.url) || info.srcUrl, page, tab.title);
    }, (n) => 'В Oddments: ' + n);
    case 'video': return run(tab, async () => {
      const v = videoOf(page);
      if (v || !info.srcUrl || /^blob:/i.test(info.srcUrl)) return saveLink(v ? v.url : page, tab.title);
      return saveFile(info.srcUrl, page, tab.title);
    }, (n) => 'В Oddments: ' + n);
    case 'link': return run(tab, () => (KNOWN.test(nameFromUrl(info.linkUrl)) ? saveFile(info.linkUrl, page) : saveLink(info.linkUrl, info.selectionText || info.linkText || '')), (n) => 'В Oddments: ' + n);
    case 'page': return run(tab, () => saveLink(page, tab.title), (n) => 'В Oddments: ' + n);
    case 'article': return run(tab, () => saveArticle(tab), (n) => 'Статья в Oddments: ' + n);
    case 'all': return ask(tab, { t: 'gallery' });
    case 'area': return run(tab, () => shotArea(tab), (n) => 'В Oddments: ' + n);
    case 'shot': return run(tab, () => shotVisible(tab), (n) => 'В Oddments: ' + n);
    case 'block': return ask(tab, { t: 'pickBlock' });
  }
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;
  if (cmd === 'shot-visible') run(tab, () => shotVisible(tab), (n) => 'В Oddments: ' + n);
  if (cmd === 'shot-area') run(tab, () => shotArea(tab), (n) => 'В Oddments: ' + n);
  if (cmd === 'save-all') ask(tab, { t: 'gallery' });
  if (cmd === 'save-article') run(tab, () => saveArticle(tab), (n) => 'Статья в Oddments: ' + n);
  if (cmd === 'grab-block') ask(tab, { t: 'pickBlock' });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tab = sender.tab;
  (async () => {
    switch (msg.t) {
      case 'status': return status();
      case 'prefs': return prefs();
      case 'saveFile': return run(tab, () => saveFile(msg.url, msg.page || (tab && tab.url), msg.alt, msg.name), (n) => 'В Oddments: ' + n);
      case 'saveLink': return run(tab, () => saveLink(msg.url, msg.title), (n) => 'В Oddments: ' + n);
      // «Забрать блок» (block.js): the window's picture for its shot, its fonts, the finished file
      case 'blockCapture': try { return { data: await captureFor(tab) }; } catch (e) { return { error: (e && e.message) || String(e) }; }
      case 'blockFonts': return { css: await blockFonts(msg.faces, msg.far, msg.want).catch(() => '') };
      case 'saveBlock': return run(tab, () => saveBlock(tab, msg), (n) => 'Блок в Oddments: ' + n);
      // a video played as a stream (Instagram not signed in): its whole video track, joined with the audio track
      case 'saveStream': return run(tab, async () => {
        const vid = new Uint8Array(await (await download(msg.video)).blob.arrayBuffer());
        let out = vid;
        if (msg.audio) {
          try { out = muxAV(vid, new Uint8Array(await (await download(msg.audio)).blob.arrayBuffer())); } catch (e) { out = vid; }
        }
        const name = cleanName(msg.title || 'Видео') + '.mp4';
        await sendBlob(new Blob([out], { type: 'video/mp4' }), name, msg.page || (tab && tab.url));
        return name;
      }, (n) => 'В Oddments: ' + n);
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
      }, (n) => 'В Oddments: ' + n);
      case 'saveMany': return saveMany(tab, msg.items);
      // a video without a file (Instagram reels and the like, Media Source): its current frame + a link card to the post
      case 'saveFrame': return run(tab, async () => {
        const blob = await (await fetch(msg.data)).blob();
        await sendBlob(blob, cleanName(msg.title || 'Кадр') + ' — кадр.png', msg.link || (tab && tab.url));
        if (/^https?:/i.test(msg.link || '')) await saveLink(msg.link, msg.title);
        return cleanName(msg.title || 'кадр');
      }, (n) => 'В Oddments: ' + n);
      // the same video recorded while it played (Alt+Shift+click): a WebM file
      case 'saveRecording': return run(tab, async () => {
        const blob = await (await fetch(msg.data)).blob();
        const name = cleanName(msg.title || 'Видео') + '.webm';
        await sendBlob(blob, name, msg.link || (tab && tab.url));
        return name;
      }, (n) => 'В Oddments: ' + n);
      // Alt+click inside a Vimeo frame (embed.js), or the hover button over its iframe (content.js)
      case 'saveEmbed': return run(tab, () => saveEmbed(tab, msg.src ? null : sender.frameId, msg.src || (sender.url || ''), tab && tab.url), (n) => 'В Oddments: ' + n);
      case 'embedInfo': return embedInfo(msg.ids || []);
      // from the popup: act on the active tab
      case 'popup': {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!t) return;
        if (msg.do === 'shot') return run(t, () => shotVisible(t), (n) => 'В Oddments: ' + n);
        if (msg.do === 'area') return run(t, () => shotArea(t), (n) => 'В Oddments: ' + n);
        if (msg.do === 'page') return run(t, () => saveLink(t.url, t.title), (n) => 'В Oddments: ' + n);
        if (msg.do === 'all') return ask(t, { t: 'gallery' });
        if (msg.do === 'article') return run(t, () => saveArticle(t), (n) => 'Статья в Oddments: ' + n);
        if (msg.do === 'block') return ask(t, { t: 'pickBlock' });
      }
    }
  })().then(reply, () => reply(undefined));
  return true; // the answer comes later
});
