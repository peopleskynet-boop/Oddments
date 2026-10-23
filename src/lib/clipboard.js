// Getting images from anywhere: Ctrl+V (browser, Figma, screenshots, Explorer files),
// drag-and-drop from a browser, and a native-clipboard fallback.
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { readImage } from '@tauri-apps/plugin-clipboard-manager';
import { extFromMime, MIME } from '../state.js';
import { splitName } from '../util.js';

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;

function nameFromUrl(u, mime) {
  try {
    const p = new URL(u).pathname.split('/').pop() || 'image';
    const dec = decodeURIComponent(p);
    const { ext } = splitName(dec);
    return ext ? dec : dec + (extFromMime(mime) ? '.' + extFromMime(mime) : '.png');
  } catch (e) { return 'image.png'; }
}

async function dataUrlToBlob(u) {
  const r = await fetch(u);
  return r.blob();
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function get(url, referer, accept) {
  const headers = { 'User-Agent': UA, Accept: accept };
  if (referer) headers.Referer = referer;
  return tfetch(url, { method: 'GET', headers });
}

// An image by URL. CDNs that check the referer (Behance, Pinterest…) get a second try with another one. A URL
// that turns out to be a page (a dragged picture inside a link gives the link) is read for its main picture:
// og:image / twitter:image / image_src.
export async function fetchImage(url, depth = 0) {
  const origin = (() => { try { return new URL(url).origin + '/'; } catch (e) { return ''; } })();
  let r = await get(url, origin, 'image/avif,image/webp,image/*,*/*;q=0.8');
  if (r.status === 403 || r.status === 401) r = await get(url, '', 'image/*,*/*;q=0.8');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const b = await r.blob();
  const type = (r.headers.get('content-type') || b.type || '').split(';')[0].trim();
  if (type === 'text/html' && depth === 0) {
    const pic = pagePicture(await b.text(), url);
    if (pic) return fetchImage(pic, 1);
    throw new Error('страница без картинки');
  }
  const ext = type.startsWith('image/') ? '' : await sniffExt(b);
  if (!type.startsWith('image/') && !IMG_EXT.test(url) && !/^(png|jpg|gif|webp|avif|bmp|svg)$/.test(ext)) throw new Error('не картинка (' + (type || 'без типа') + ')');
  return { blob: b.type ? b : new Blob([b], { type }), name: nameFromUrl(url, type), source: url };
}

// a page's main picture, as social previews announce it
function pagePicture(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const m = doc.querySelector('meta[property="og:image:secure_url"], meta[property="og:image"], meta[name="twitter:image"], meta[name="twitter:image:src"]');
  const v = (m && m.getAttribute('content')) || (doc.querySelector('link[rel="image_src"]') || {}).href;
  return v ? absUrl(v, base) : '';
}

const absUrl = (u, base) => { try { return new URL(u.startsWith('//') ? 'https:' + u : u, base || undefined).href; } catch (e) { return ''; } };

// the largest candidate of a srcset («a.jpg 1x, b.jpg 2x» or «a.jpg 400w, b.jpg 1400w»)
function largest(srcset) {
  const c = (srcset || '').split(/,\s+(?=\S)/).map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
  if (!c.length) return '';
  const size = (d) => (d ? parseFloat(d) * (/x$/.test(d) ? 1000 : 1) : 1);
  return c.sort((a, b) => size(b[1]) - size(a[1]))[0][0];
}

// the pictures a dragged / copied HTML fragment points to: one group per <img>, its candidates best first —
// real sources over lazy-load placeholders (Behance and others keep the picture in srcset / data-src and a 1×1
// gif in src), then its <picture> sources, then a link around it if that link is an image
function imgGroupsFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const groups = [], seen = new Set();
  doc.querySelectorAll('img').forEach((im) => {
    const g = [];
    const add = (u) => { u = absUrl(u || ''); if (u && !/^data:image\/gif/i.test(u) && !g.includes(u)) g.push(u); };
    add(largest(im.getAttribute('srcset') || im.getAttribute('data-srcset')));
    add(im.getAttribute('data-src') || im.getAttribute('data-original'));
    add(im.getAttribute('src'));
    const pic = im.closest('picture');
    if (pic) pic.querySelectorAll('source').forEach((x) => add(largest(x.getAttribute('srcset'))));
    const a = im.closest('a[href]');
    if (a && IMG_EXT.test(a.getAttribute('href'))) add(a.getAttribute('href'));
    if (g.length && !seen.has(g[0])) { seen.add(g[0]); groups.push(g); }
  });
  return groups;
}

// What a file really is, from its first bytes: browsers hand over dragged pictures as «download» with no
// extension (Behance, many CDNs serve images from extension-less URLs) and the card then had no picture.
const SIGS = [
  ['png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['gif', (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46],
  ['webp', (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50],
  ['avif', (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69],
  ['bmp', (b) => b[0] === 0x42 && b[1] === 0x4d],
  ['mp4', (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70],
  ['webm', (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3],
];
export async function sniffExt(blob) {
  try {
    const b = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    for (const [ext, test] of SIGS) if (test(b)) return ext;
    const head = new TextDecoder().decode(b).trimStart().toLowerCase();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && (await blob.slice(0, 2048).text()).includes('<svg'))) return 'svg';
  } catch (e) { /* unreadable: leave it */ }
  return '';
}
const KNOWN = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|mp4|webm|mov|m4v|mkv|psd|pdf|glb|gltf|obj|fbx|blend|zip)$/i;
// a file whose name does not say what it is gets the extension its bytes say («download» → «download.webp»)
async function namedRight(f) {
  const name = f.name || 'image';
  if (KNOWN.test(name)) return { blob: f, name };
  const ext = await sniffExt(f) || extFromMime(f.type);
  return ext ? { blob: f, name: name.replace(/\.[a-z0-9]{1,5}$/i, '') + '.' + ext } : null;
}

// local files dragged as links: Telegram Desktop and some apps hand over file:/// URIs or plain Windows paths
// instead of file objects; those go in through the library like files from Explorer
function localPaths(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    if (/^file:\/\//i.test(l)) { try { return decodeURIComponent(new URL(l).pathname).replace(/^\/([a-z]:)/i, '$1').replace(/\//g, '\\'); } catch (e) { return ''; } }
    return /^[a-z]:\\/i.test(l) ? l : '';
  }).filter(Boolean);
}

// dt is DataTransfer (paste/drop). Returns [{blob,name,source}]; local paths that came as text are in out.paths
export async function extractFromTransfer(dt) {
  const out = [];
  out.paths = [];
  // files: dt.files, or dt.items of kind «file» (some sources fill one and not the other)
  let files = Array.from(dt.files || []);
  if (!files.length && dt.items) files = Array.from(dt.items).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  for (const f of files) { const r = await namedRight(f); if (r) out.push({ ...r, source: '' }); }
  if (out.length) return out;
  const html = dt.getData('text/html');
  const text = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
  // one group per picture; the plain links (the page a dragged picture links to, or an image) are the last
  // resort, tried after the picture's own sources
  const groups = html ? imgGroupsFromHtml(html) : [];
  const links = text ? text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(https?:|data:image)/i.test(l)) : [];
  if (!groups.length && links.length) groups.push(links);
  else if (links.length) groups[groups.length - 1].push(...links.filter((l) => !groups.some((g) => g.includes(l))));
  for (const g of groups) {
    for (const u of g) {
      try {
        if (u.startsWith('data:')) {
          const b = await dataUrlToBlob(u);
          out.push({ blob: b, name: 'image.' + (extFromMime(b.type) || 'png'), source: '' });
        } else {
          const r = await fetchImage(u);
          // an extension-less URL: name the file by what came back
          if (!KNOWN.test(r.name)) { const ext = await sniffExt(r.blob); if (ext) r.name = r.name.replace(/\.[a-z0-9]{1,5}$/i, '') + '.' + ext; }
          out.push(r);
        }
        break; // this picture is in; its other candidates are the same picture
      } catch (e) { out.err = (e && e.message) || String(e); console.warn('не удалось скачать', u, e); }
    }
  }
  if (!out.length && text) out.paths = localPaths(text);
  return out;
}

// Native clipboard (works when the web layer does not expose the image). One read at a time: Ctrl+V can ask
// twice (the paste event and the keydown fallback) and two reads of the Windows clipboard at once collide.
let reading = null;
export function readNativeClipboardImage() {
  if (!reading) reading = readNative().finally(() => { reading = null; });
  return reading;
}
async function readNative() {
  try {
    const img = await readImage();
    const { width, height } = await img.size();
    if (!width || !height || width * height > 120e6) return []; // empty or absurd bitmaps: leave them alone
    const rgba = await img.rgba();
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return blob ? [{ blob, name: 'Вставка ' + new Date().toLocaleTimeString('ru').replace(/:/g, '-') + '.png', source: '' }] : [];
  } catch (e) { return []; }
}

export { MIME };
