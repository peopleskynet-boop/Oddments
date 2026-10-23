// Pictures and clips from other sites (the feed, the digest, saved articles). The exe's CSP lets an <img>/<video>
// load only the app's own files, blob: and data: (img-src 'self' asset: blob: data:) — a remote address shows nothing
// there (bug #51). So in the app they are fetched by the app itself (plugin-http, with the site as referer) and shown
// as blob: URLs; the CSP stays strict. In the browser build (no CSP) the address is used as it is.
// Markup asks for it with data-src (img, video), data-poster (video) and data-bg (a CSS background); hydrate(root)
// fills in what is on or near the screen. A picture that fails is hidden, never shown as a broken icon.
import { fetch as tfetch } from '@tauri-apps/plugin-http';

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Oddments';
const LIMIT = 220, MAX_VIDEO = 80 * 1024 * 1024;
const cache = new Map(); // url → Promise<blob url>, oldest first (revoked when it falls out)
let busy = 0;
const waiting = [];
const slot = () => (busy < 6 ? (busy++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const done = () => { busy--; const n = waiting.shift(); if (n) { busy++; n(); } };

async function load(url) {
  await slot();
  try {
    let origin = '';
    try { origin = new URL(url).origin + '/'; } catch (e) { /* bad url */ }
    const r = await tfetch(url, { method: 'GET', headers: { 'User-Agent': UA, ...(origin ? { Referer: origin } : {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const len = +(r.headers.get('content-length') || 0);
    if (len > MAX_VIDEO) throw new Error('слишком большой файл');
    return URL.createObjectURL(await r.blob());
  } finally { done(); }
}

export function viewUrl(url) {
  if (!url || !/^https?:/i.test(url) || !inApp()) return Promise.resolve(url || '');
  if (cache.has(url)) { const p = cache.get(url); cache.delete(url); cache.set(url, p); return p; }
  const p = load(url);
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  while (cache.size > LIMIT) {
    const [k, old] = cache.entries().next().value;
    cache.delete(k);
    old.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return p;
}

// fill data-src / data-poster / data-bg under root (once per element)
export function hydrate(root) {
  if (!root) return;
  root.querySelectorAll('[data-src]:not([data-rs]), [data-bg]:not([data-rs]), [data-poster]:not([data-rs])').forEach((el) => {
    el.dataset.rs = '1';
    const hide = () => { if (el.tagName === 'IMG') { el.hidden = true; el.closest('[data-pic]')?.classList.add('nopic'); } };
    if (el.dataset.bg) viewUrl(el.dataset.bg).then((u) => { if (u) el.style.backgroundImage = `url("${u}")`; }).catch(() => {});
    if (el.dataset.poster) viewUrl(el.dataset.poster).then((u) => { el.poster = u; }).catch(() => {});
    if (el.dataset.src) {
      if (el.tagName === 'IMG') el.addEventListener('error', hide, { once: true });
      // the app's own download first (the site's Referer, bug #51); a site that refuses it may still give the picture
      // to the webview directly (img-src / media-src https:) — only then is it hidden (reader pictures, bug #95)
      const direct = () => { if (/^https:/i.test(el.dataset.src) && el.src !== el.dataset.src) el.src = el.dataset.src; else hide(); };
      viewUrl(el.dataset.src).then((u) => { if (u) el.src = u; else direct(); }).catch(direct);
    }
  });
}
