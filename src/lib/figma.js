// Figma in the library:
// - recognising Figma's own clipboard (it carries layer data, not an image) to give a useful hint;
// - Figma links saved as .url files with a drawn card as the thumbnail;
// - .fig files: a ZIP with a ready thumbnail.png inside (older binary .fig files have none).

const FIGMA_URL = /^https?:\/\/(?:www\.)?figma\.com\/(design|file|proto|board|slides|make|community\/file)\/([A-Za-z0-9]+)(?:\/([^?#\s]*))?/i;

// Figma's Ctrl+C puts HTML with (figmeta)…(/figmeta) and (figma)…(/figma) blocks on the clipboard.
export function figmaClipboard(dt) {
  const html = (dt && dt.getData && dt.getData('text/html')) || '';
  if (!html.includes('(figmeta)') && !html.includes('(figma)')) return null;
  const m = html.match(/\(figmeta\)([A-Za-z0-9+/=]+)\(\/figmeta\)/);
  let meta = {};
  if (m) { try { meta = JSON.parse(atob(m[1])); } catch (e) { /* unknown layout */ } }
  return { fileKey: meta.fileKey || null };
}

export function parseFigmaUrl(text) {
  const m = (text || '').trim().match(FIGMA_URL);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const slug = decodeURIComponent((m[3] || '').split('/')[0] || '').replace(/[-_]+/g, ' ').trim();
  return { url: m[0], kind, key: m[2], title: slug || 'Файл Figma' };
}

const KIND_RU = { design: 'Дизайн', file: 'Дизайн', proto: 'Прототип', board: 'FigJam', slides: 'Слайды', make: 'Make', 'community/file': 'Сообщество' };

// Video links (YouTube, Shorts, youtu.be, Vimeo, Pinterest pins): kept as link cards with the clip's cover.
// Downloading the file itself is a separate, still open decision (yt-dlp in the installer or not).
const VIDEO_URLS = [
  { site: 'YouTube', re: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})[^\s]*/i },
  { site: 'Vimeo', re: /^https?:\/\/(?:www\.)?vimeo\.com\/(?:.*\/)?(\d{5,})[^\s]*/i },
  { site: 'Pinterest', re: /^https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?pinterest\.[a-z.]+\/pin\/([\w-]+)[^\s]*/i },
  { site: 'Pinterest', re: /^https?:\/\/pin\.it\/([\w-]+)[^\s]*/i },
];
export function parseVideoUrl(text) {
  const t = (text || '').trim();
  for (const v of VIDEO_URLS) { const m = t.match(v.re); if (m) return { url: m[0], site: v.site, id: m[1] }; }
  return null;
}

// the clip's title from the site's oEmbed (YouTube, Vimeo), or null
export async function videoTitle(v) {
  const api = v.site === 'YouTube' ? 'https://www.youtube.com/oembed?format=json&url=' : v.site === 'Vimeo' ? 'https://vimeo.com/api/oembed.json?url=' : '';
  if (!api) return null;
  try {
    const { fetch: tfetch } = await import('@tauri-apps/plugin-http');
    const r = await tfetch(api + encodeURIComponent(v.url), { method: 'GET' });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.title || '').trim() || null;
  } catch (e) { return null; }
}

// width / height of the clip, so the embedded player has its shape (a vertical Vimeo in a 16:9 frame got
// white bars and a tiny picture): Vimeo from oEmbed, YouTube Shorts are 9:16, the rest 16:9
const vimeo = new Map();
// Vimeo's oEmbed: the clip's shape and a cover in that shape (the page's og:image is a 16:9 crop)
export function vimeoInfo(v) {
  if (!vimeo.has(v.id)) {
    vimeo.set(v.id, (async () => {
      try {
        const { fetch: tfetch } = await import('@tauri-apps/plugin-http');
        const r = await tfetch('https://vimeo.com/api/oembed.json?width=1280&url=' + encodeURIComponent(`https://vimeo.com/${v.id}`), { method: 'GET' });
        if (!r.ok) return null;
        const j = await r.json();
        return { ar: j.width > 0 && j.height > 0 ? j.width / j.height : 16 / 9, thumb: j.thumbnail_url || '', title: j.title || '' };
      } catch (e) { return null; }
    })());
  }
  return vimeo.get(v.id);
}
export async function videoAspect(v) {
  if (v.site === 'YouTube') return /\/shorts\//i.test(v.url) ? 9 / 16 : 16 / 9;
  if (v.site !== 'Vimeo') return 16 / 9;
  const i = await vimeoInfo(v);
  return i ? i.ar : 16 / 9;
}

// A Windows .url shortcut: opens in the browser (or the Figma app) by double click, and is a real file.
export function urlShortcut(url) {
  return new Blob([`[InternetShortcut]\r\nURL=${url}\r\n`], { type: 'application/x-url' });
}
export function urlFromShortcut(text) {
  const m = (text || '').match(/^URL=(.+)$/m);
  return m ? m[1].trim() : '';
}

// Card for a link: Figma links get the Figma mark and the file name, other links their domain.
export function linkCard(url, W = 640, H = 480) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const f = parseFigmaUrl(url);
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, f ? '#1e1e24' : '#202024'); g.addColorStop(1, f ? '#2c2235' : '#2a2a2f');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  if (f) {
    // the Figma mark: five rounded shapes
    const s = 46, ox = 56, oy = 60;
    const cols = ['#f24e1e', '#ff7262', '#a259ff', '#1abcfe', '#0acf83'];
    const rr = (cx, cy, w, h, r, col) => { x.fillStyle = col; x.beginPath(); x.roundRect(cx, cy, w, h, r); x.fill(); };
    rr(ox, oy, s, s, [s / 2, 0, 0, s / 2], cols[0]);
    rr(ox + s, oy, s, s, [0, s / 2, s / 2, 0], cols[1]);
    rr(ox, oy + s, s, s, [s / 2, 0, 0, s / 2], cols[2]);
    x.fillStyle = cols[3]; x.beginPath(); x.arc(ox + s * 1.5, oy + s * 1.5, s / 2, 0, 7); x.fill();
    rr(ox, oy + s * 2, s, s, [s / 2, 0, s / 2, s / 2], cols[4]);
  }
  x.fillStyle = '#f5f5f7';
  x.font = `650 ${f ? 46 : 40}px "Golos Text Variable", "Segoe UI", sans-serif`;
  const title = f ? f.title : (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } })();
  wrap(x, title, f ? 210 : 56, f ? 120 : 200, W - (f ? 260 : 112), 54, 3);
  x.fillStyle = '#98989f';
  x.font = '500 24px "Golos Text Variable", "Segoe UI", sans-serif';
  x.fillText(f ? `Figma · ${KIND_RU[f.kind] || 'Файл'}` : 'Ссылка', f ? 210 : 56, H - 56);
  return c;
}

function wrap(x, text, left, top, width, lh, maxLines) {
  const words = text.split(/\s+/);
  let line = '', y = top, n = 0;
  for (let i = 0; i < words.length; i++) {
    const t = line ? line + ' ' + words[i] : words[i];
    if (x.measureText(t).width > width && line) {
      if (++n === maxLines) { x.fillText(line + '…', left, y); return; }
      x.fillText(line, left, y); line = words[i]; y += lh;
    } else line = t;
  }
  if (line) x.fillText(line, left, y);
}

/* ---------- .fig ---------- */

// Minimal ZIP reader: finds one entry by name through the central directory.
async function zipEntry(blob, name) {
  const tailLen = Math.min(blob.size, 66000);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  for (let p = 0, k = 0; k < count && p + 46 <= cd.byteLength; k++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    const local = cd.getUint32(p + 42, true);
    const fname = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    if (fname === name) {
      // a thumbnail is small: anything that unpacks to more than 64 MB is not one (audit #38, zip bombs)
      if (usize > 64 << 20 || csize > 64 << 20) return null;
      const lh = new DataView(await blob.slice(local, local + 30).arrayBuffer());
      const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const data = blob.slice(start, start + csize);
      if (method === 0) return data;
      if (method === 8 && typeof DecompressionStream !== 'undefined') return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      return null;
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

// { canvas, w, h } from the thumbnail inside a .fig, or null
export async function figThumb(blob) {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) return null; // not a ZIP: old binary .fig without a preview
  const png = await zipEntry(blob, 'thumbnail.png');
  if (!png) return null;
  const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return { canvas: c, w: c.width, h: c.height };
}
