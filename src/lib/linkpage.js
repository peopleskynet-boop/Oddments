// A link's card from its page: the cover picture, the title, the description, the site's name and icon. The words
// come from linkmeta.js; this file fetches (plugin-http through nethttp.js — nothing leaves in «Без сети») and draws.
// What the shortcut itself carries ([Oddments]: the browser extension or Claude saw the page) wins over the page:
// ArtStation and Dribbble answer Oddments with a bot wall, the person's browser saw the real thing.
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { pageMeta, siteName, hostOf } from './linkmeta.js';
import { isOffline } from './net.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const PAGE_MAX = 1500000; // the <head> is at the start; a huge page is not read whole
const COVER = 960; // the long side of a cover: sharp on a wide card in the list and on the wall

async function get(url, accept, ms = 15000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await tfetch(url, { method: 'GET', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': `${navigator.language || 'en'},en;q=0.8` } });
  } finally { clearTimeout(timer); }
}

// the page's own words; { status } alone when it answered with an error (403 of a bot wall)
async function readPage(url) {
  const r = await get(url, 'text/html,application/xhtml+xml,*/*;q=0.8');
  if (!r.ok) return { status: r.status };
  const type = r.headers.get('content-type') || '';
  if (type && !/html|xml/i.test(type)) return { status: r.status };
  return { status: r.status, meta: pageMeta((await r.text()).slice(0, PAGE_MAX), r.url || url) };
}

// a picture by address: a data: picture (a shot from the extension) decodes here, the rest is fetched as clipboard.js
// does (a second try with another Referer for CDNs that check it)
async function pictureBlob(src) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(src);
  if (m) {
    const bin = atob(m[2].replace(/\s+/g, '')), b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return new Blob([b], { type: m[1] });
  }
  const { fetchImage } = await import('./clipboard.js');
  return (await fetchImage(src, 1)).blob; // depth 1: an HTML answer is not read for its own picture
}
// ImageBitmap first; SVG and ICO through an <img> (createImageBitmap does not take every format)
async function decode(blob) {
  try { return await createImageBitmap(blob); } catch (e) { /* below */ }
  const u = URL.createObjectURL(blob);
  try {
    const im = new Image();
    im.src = u;
    await im.decode();
    return im;
  } finally { URL.revokeObjectURL(u); }
}

// the site's icon as a 64 px PNG (the card's pill draws it at 14–16 px) and its colour, for a card without a picture
async function iconOf(src) {
  const pic = await decode(await pictureBlob(src));
  const w = pic.width || pic.naturalWidth, h = pic.height || pic.naturalHeight;
  if (!w || !h) return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const s = Math.min(64 / w, 64 / h);
  x.drawImage(pic, (64 - w * s) / 2, (64 - h * s) / 2, w * s, h * s);
  if (pic.close) pic.close();
  return { blob: await new Promise((r) => c.toBlob(r, 'image/png')), tint: tintOf(x.getImageData(0, 0, 64, 64).data) };
}
// the icon's colour: the mean of its coloured, opaque pixels ('' for a black, white or grey icon)
function tintOf(d) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] < 200) continue;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
    if (mx - mn < 60 || mx < 50) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (n < 6) return '';
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return '#' + hex(r) + hex(g) + hex(b);
}

// Everything a card needs. Never throws: what failed is simply missing. `retry`: nothing could be asked at all
// («Без сети»), so the link is tried again at the next start rather than kept bare for good.
export async function readLinkPage(url, sc = {}) {
  const out = { title: sc.title || '', desc: sc.desc || '', site: '', host: hostOf(url), cover: null, icon: null, tint: '', retry: false };
  if (isOffline()) { out.retry = true; out.site = siteName(url, sc.site); return out; }
  // the extension sent the picture and the title: the page is not asked again (it may be behind a wall anyway)
  let meta = null;
  if (!(sc.image && sc.title)) {
    try { meta = (await readPage(url)).meta || null; } catch (e) { if (e && e.name === 'OfflineError') out.retry = true; }
  }
  out.title = out.title || (meta && meta.title) || '';
  out.desc = out.desc || (meta && meta.desc) || '';
  out.site = siteName(url, sc.site || (meta && meta.site) || '');
  const image = sc.image || (meta && meta.image) || '';
  if (image) { try { out.cover = await decode(await pictureBlob(image)); } catch (e) { console.warn('link cover', url, e); } }
  const icon = sc.icon || (meta && meta.icon) || (() => { try { return new URL('/favicon.ico', url).href; } catch (e) { return ''; } })();
  if (icon) { try { const i = await iconOf(icon); if (i) { out.icon = i.blob; out.tint = i.tint; } } catch (e) { /* no icon: the pill shows the letter */ } }
  return out;
}

// the cover in its own shape, but not a strip or a tower: between 2:1 and 2:3, the middle kept
export function coverCanvas(pic) {
  const w = pic.width || pic.naturalWidth, h = pic.height || pic.naturalHeight;
  const ar = Math.min(2, Math.max(2 / 3, w / h));
  const sw = Math.min(w, h * ar), sh = sw / ar;
  const s = Math.min(1, COVER / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
  c.getContext('2d').drawImage(pic, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, c.width, c.height);
  return c;
}
