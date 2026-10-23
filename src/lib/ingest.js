// Builds a thumbnail (and metadata) for every supported file kind.
// `src` is { size, getBlob(): Promise<Blob>, url(): string } — the file may live on disk,
// so heavy formats are only read into memory when they are small enough.
import { toHex, colorDist } from '../util.js';
import { extractPalette, PALETTE_V } from './palette.js';

const MAX_THUMB = 640;

export const toBlob = (canvas, type = 'image/webp', q = 0.82) =>
  new Promise((res) => canvas.toBlob((b) => res(b), type, q));

function fitCanvas(w, h, draw) {
  const s = Math.min(1, MAX_THUMB / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  draw(c.getContext('2d'), c.width, c.height);
  return c;
}

export function loadImg(url, cors = false) {
  return new Promise((res, rej) => {
    const im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image decode failed'));
    im.src = url;
  });
}

function once(el, evt, ms = 15000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { cleanup(); rej(new Error('timeout ' + evt)); }, ms);
    const ok = () => { cleanup(); res(); };
    const bad = () => { cleanup(); rej(new Error('media error')); };
    function cleanup() { clearTimeout(t); el.removeEventListener(evt, ok); el.removeEventListener('error', bad); }
    el.addEventListener(evt, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

// Dominant colours from a canvas (downscaled to ~40px).
// the palette (palette.js): colours plus their shares; `extractColors` keeps the old shape for the callers that only
// need the colours
export const extractColors = (source) => extractPalette(source).colors;

/* ---------- per-kind generators: return { w, h, canvas, preview?, duration?, pages? } ---------- */

async function genImage(src) {
  const blob = await src.getBlob();
  const u = URL.createObjectURL(blob);
  try {
    const im = await loadImg(u);
    const w = im.naturalWidth || 300, h = im.naturalHeight || 300;
    return { w, h, canvas: fitCanvas(w, h, (x, cw, ch) => x.drawImage(im, 0, 0, cw, ch)) };
  } finally { URL.revokeObjectURL(u); }
}

async function genVideo(src) {
  let url, revoke = null;
  const useBlob = src.size <= 150e6;
  if (useBlob) { url = URL.createObjectURL(await src.getBlob()); revoke = url; } else url = src.url();
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true;
  if (!useBlob) v.crossOrigin = 'anonymous';
  v.src = url;
  try {
    await once(v, 'loadeddata');
    const dur = v.duration;
    v.currentTime = isFinite(dur) ? Math.max(0.05, Math.min(1, dur * 0.1)) : 0.05;
    await once(v, 'seeked', 10000);
    const w = v.videoWidth || 640, h = v.videoHeight || 360;
    return { w, h, canvas: fitCanvas(w, h, (x, cw, ch) => x.drawImage(v, 0, 0, cw, ch)), duration: isFinite(dur) ? dur : 0 };
  } finally { v.removeAttribute('src'); v.load(); if (revoke) URL.revokeObjectURL(revoke); }
}

async function genAudio(src) {
  if (src.size > 80e6) return {};
  const buf = await (await src.getBlob()).arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const a = await ac.decodeAudioData(buf);
    const ch = a.getChannelData(0), bars = 96, step = Math.max(1, Math.floor(ch.length / bars));
    const peaks = [];
    for (let i = 0; i < bars; i++) {
      let mx = 0;
      for (let j = i * step; j < Math.min(ch.length, (i + 1) * step); j += Math.ceil(step / 200)) mx = Math.max(mx, Math.abs(ch[j]));
      peaks.push(mx);
    }
    const top = Math.max(...peaks, 0.01);
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const x = c.getContext('2d');
    x.fillStyle = '#1b1f23'; x.fillRect(0, 0, 640, 360);
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#3ec7bd';
    x.fillStyle = acc;
    const bw = 640 / bars;
    peaks.forEach((p, i) => {
      const h = Math.max(4, (p / top) * 250);
      x.fillRect(i * bw + 1.5, 180 - h / 2, bw - 3, h);
    });
    return { w: 640, h: 360, canvas: c, duration: a.duration };
  } finally { ac.close(); }
}

async function genFont(src, it) {
  const buf = await (await src.getBlob()).arrayBuffer();
  const fam = 'pf-gen-' + it.id;
  const face = new FontFace(fam, buf);
  await face.load();
  document.fonts.add(face);
  try {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const x = c.getContext('2d');
    x.fillStyle = '#e9ebee'; x.fillRect(0, 0, 640, 480);
    x.fillStyle = '#14171a'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `230px "${fam}"`; x.fillText('Aa', 320, 210);
    x.font = `34px "${fam}"`; x.fillText('Абвгд 0123456789', 320, 400);
    return { w: 640, h: 480, canvas: c };
  } finally { document.fonts.delete(face); }
}

let pdfjsP = null;
export function loadPdfjs() {
  if (!pdfjsP) {
    pdfjsP = (async () => {
      const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })();
  }
  return pdfjsP;
}

async function genPdf(src) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await (await src.getBlob()).arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(1);
    const v0 = page.getViewport({ scale: 1 });
    const scale = MAX_THUMB / Math.max(v0.width, v0.height);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp, canvas: c }).promise;
    return { w: v0.width, h: v0.height, canvas: c, pages: doc.numPages };
  } finally { doc.destroy(); }
}

// One shared worker parses PSDs in the background (see psd.worker.js).
let psdWorker = null, psdSeq = 0;
const psdWaiting = new Map();
function parsePsdInWorker(buf) {
  if (!psdWorker) {
    psdWorker = new Worker(new URL('./psd.worker.js', import.meta.url), { type: 'module' });
    psdWorker.onmessage = (e) => { const p = psdWaiting.get(e.data.id); if (p) { psdWaiting.delete(e.data.id); p(e.data); } };
    psdWorker.onerror = () => { psdWaiting.forEach((p) => p({ error: 'worker' })); psdWaiting.clear(); psdWorker = null; };
  }
  const id = ++psdSeq;
  return new Promise((res) => { psdWaiting.set(id, res); psdWorker.postMessage({ id, buf }, [buf]); });
}

async function genPsd(src) {
  if (src.size > 400e6) return {};
  const blob = await src.getBlob();
  let full = null, psd = null;
  try {
    const r = await parsePsdInWorker(await blob.arrayBuffer());
    if (r.bitmap) full = r.bitmap;
    if (r.w) psd = { width: r.w, height: r.h };
  } catch (e) { /* fall back below */ }
  if (!full) {
    // no composite image (or no worker): parse on the main thread and use the embedded thumbnail
    const { readPsd } = await import('ag-psd');
    psd = readPsd(await blob.arrayBuffer(), { skipLayerImageData: true, skipThumbnail: false });
    full = psd.canvas || (psd.imageResources && psd.imageResources.thumbnail);
  }
  if (!full) return { w: psd.width, h: psd.height };
  const w = psd.width || full.width, h = psd.height || full.height;
  const canvas = fitCanvas(full.width, full.height, (x, cw, ch) => x.drawImage(full, 0, 0, cw, ch));
  // Full composite is saved as PNG for the viewer (scaled down if gigantic).
  let preview = full;
  const maxSide = 4096;
  if (Math.max(full.width, full.height) > maxSide || !(full instanceof HTMLCanvasElement)) {
    const s = Math.min(1, maxSide / Math.max(full.width, full.height));
    preview = document.createElement('canvas');
    preview.width = Math.round(full.width * s); preview.height = Math.round(full.height * s);
    preview.getContext('2d').drawImage(full, 0, 0, preview.width, preview.height);
  }
  return { w, h, canvas, preview };
}

// 3D: an off-screen Three.js render; .blend: the preview Blender stores in the file header.
async function genModel(src, it) {
  const { renderModelThumb, blendThumb, hasViewer } = await import('./model3d.js');
  const blob = await src.getBlob();
  if (it.ext === 'blend') return (await blendThumb(blob)) || {};
  if (!hasViewer(it) || src.size > 300e6) return {};
  return renderModelThumb(await blob.arrayBuffer(), it.ext, MAX_THUMB, Math.round(MAX_THUMB * 0.75));
}

async function genFig(src) {
  const { figThumb } = await import('./figma.js');
  return (await figThumb(await src.getBlob())) || {};
}
async function genLink(src) {
  const { linkCard, urlFromShortcut, parseVideoUrl } = await import('./figma.js');
  const url = urlFromShortcut(await (await src.getBlob()).text());
  if (!url) return {};
  const vid = parseVideoUrl(url);
  if (vid) { const r = await videoCard(vid).catch(() => null); if (r) return r; }
  const canvas = linkCard(url);
  return { canvas, w: canvas.width, h: canvas.height };
}

// a video link's card: the clip's cover (YouTube's own thumbnail, else the page's main picture) in the clip's shape, a play
// mark and the site's name; the cover's colours count for the colour search
async function videoCard(v) {
  const { fetchImage } = await import('./clipboard.js');
  const vi = v.site === 'Vimeo' ? await (await import('./figma.js')).vimeoInfo(v) : null;
  const cover = v.site === 'YouTube'
    ? await fetchImage(`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`).catch(() => fetchImage(v.url))
    : vi && vi.thumb ? await fetchImage(vi.thumb).catch(() => fetchImage(v.url)) : await fetchImage(v.url);
  const bm = await createImageBitmap(cover.blob);
  // the card takes the clip's own shape (square and vertical clips were cut to 16:9); long side 1280
  const { videoAspect } = await import('./figma.js');
  const ar = Math.min(16 / 9, Math.max(9 / 16, await videoAspect(v).catch(() => 16 / 9)));
  const W = Math.round(ar >= 1 ? 1280 : 1280 * ar), H = Math.round(ar >= 1 ? 1280 / ar : 1280), c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const s = Math.max(W / bm.width, H / bm.height);
  x.drawImage(bm, (W - bm.width * s) / 2, (H - bm.height * s) / 2, bm.width * s, bm.height * s);
  const colorSrc = document.createElement('canvas'); colorSrc.width = W; colorSrc.height = H; colorSrc.getContext('2d').drawImage(c, 0, 0);
  // the play mark: a soft dark disc with a white triangle, the site's name under the corner
  x.fillStyle = 'rgba(0,0,0,.45)'; x.beginPath(); x.arc(W / 2, H / 2, 74, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(W / 2 - 22, H / 2 - 36); x.lineTo(W / 2 + 40, H / 2); x.lineTo(W / 2 - 22, H / 2 + 36); x.closePath(); x.fill();
  x.font = '600 30px "Golos Text Variable", "Segoe UI", sans-serif';
  const tw = x.measureText(v.site).width;
  x.fillStyle = 'rgba(0,0,0,.55)'; x.beginPath(); x.roundRect(28, H - 82, tw + 40, 54, 27); x.fill();
  x.fillStyle = '#fff'; x.fillText(v.site, 48, H - 45);
  return { canvas: c, colorSrc, w: W, h: H };
}

// a block of a page: its shot (blockCover: the top of a long one, a thin strip on its own background). The size is
// the block's own, in CSS pixels, not the shot's
async function genBlock(src) {
  const { readBlock, blockCover } = await import('./block.js');
  const b = readBlock(new Uint8Array(await (await src.getBlob()).arrayBuffer()));
  if (!b.shot) return {};
  const bm = await createImageBitmap(b.shot);
  const canvas = blockCover(bm, b.meta.background, MAX_THUMB);
  const w = b.meta.w || bm.width, h = b.meta.h || bm.height;
  bm.close();
  return { canvas, w, h };
}

const GEN = { block: genBlock, image: genImage, gif: genImage, video: genVideo, audio: genAudio, font: genFont, pdf: genPdf, psd: genPsd, model: genModel, material: genModel, figma: genFig, link: genLink };

// Returns { w, h, ar, duration, pages, colors, thumb: Blob|null, preview: Blob|null, verts?, tris? }
export async function generate(it, src) {
  const out = { w: 0, h: 0, ar: 0.75, duration: 0, pages: 0, colors: [], thumb: null, preview: null };
  const fn = GEN[it.kind];
  if (!fn) return out;
  try {
    const r = await fn(src, it);
    if (r.w) { out.w = r.w; out.h = r.h; }
    if (r.duration) out.duration = r.duration;
    if (r.pages) out.pages = r.pages;
    if (r.verts) { out.verts = r.verts; out.tris = r.tris; }
    if (r.canvas) {
      out.ar = r.canvas.height / r.canvas.width;
      out.thumb = await toBlob(r.canvas);
      if (r.colorSrc || (it.kind !== 'audio' && it.kind !== 'font' && it.kind !== 'link')) { // a video link's cover counts
        try { const p = extractPalette(r.colorSrc || r.canvas); out.colors = p.colors; out.shares = p.shares; out.palV = PALETTE_V; } catch (e) { /* tainted canvas etc. */ }
      }
    }
    if (r.preview) out.preview = await toBlob(r.preview, 'image/png');
  } catch (e) {
    console.warn('preview failed for', it.name, e);
  }
  return out;
}
