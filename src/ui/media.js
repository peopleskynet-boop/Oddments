// Pixels of a library file for the right-click menus: copy the picture, read the colour under the cursor,
// keep a video frame as a new reference. The file is read through fs (like the rest of the library) and drawn
// from a blob: URL, so the canvas stays readable (an asset:// image would taint it).
import * as fs from '@tauri-apps/plugin-fs';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { absPath, addFromBlobs, saveIndex } from '../lib/library.js';
import { MIME, pictureRel } from '../state.js';
import { toHex } from '../util.js';
import { t as tr } from '../lib/i18n.js'; // `t` is the frame's time here

export async function fileBlob(it, rel = it.file) {
  return new Blob([await fs.readFile(absPath(rel))], { type: MIME[it.ext] || '' });
}

async function bitmapOf(it) {
  const rel = pictureRel(it);
  if (!rel) throw new Error('нет картинки');
  const blob = await fileBlob(it, rel);
  return rel === it.file && it.ext === 'svg' ? svgCanvas(blob) : createImageBitmap(blob);
}

// createImageBitmap does not take SVG: it is drawn through an <img>, 1024 px on the long side at least, so a 24 px icon
// comes out crisp (the proportions from the viewBox — an SVG without width/height has no size of its own)
async function svgCanvas(blob) {
  const text = await blob.text();
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const root = (/<svg\b[^>]*>/i.exec(text) || [''])[0];
    const vb = /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i.exec(root);
    const sized = /\swidth\s*=\s*["']?\s*[\d.]+\s*(px)?\s*["'\s>/]/i.test(root) && /\sheight\s*=\s*["']?\s*[\d.]+\s*(px)?\s*["'\s>/]/i.test(root);
    let w = img.naturalWidth || 0, h = img.naturalHeight || 0;
    if (vb && +vb[1] > 0 && +vb[2] > 0 && (!sized || !w || !h)) { w = +vb[1]; h = +vb[2]; }
    if (!w || !h) { w = 512; h = 512; }
    const k = Math.min(4096 / Math.max(w, h), Math.max(1, 1024 / Math.max(w, h)));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

// an SVG's own markup: Figma and Illustrator take it pasted as text and make vector layers of it
export async function svgText(it) {
  return (await fileBlob(it)).text();
}

function pngOf(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  return new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('png'))), 'image/png'));
}

export async function toClipboard(png) {
  // the web clipboard keeps the PNG as is; the plugin is the fallback (it needs the bytes)
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); return; } catch (e) { /* fall through */ }
  await writeImage(new Uint8Array(await png.arrayBuffer()));
}

// copy the picture as PNG (works for Figma, Photoshop, messengers)
export async function copyImage(it) {
  const bm = await bitmapOf(it);
  await toClipboard(await pngOf(bm, bm.width, bm.height));
}

// the colour at a point given as fractions of the picture (0..1 from the left / the top)
export async function colorAt(it, fx, fy) {
  const bm = await bitmapOf(it);
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  const x = Math.min(bm.width - 1, Math.max(0, Math.floor(fx * bm.width))), y = Math.min(bm.height - 1, Math.max(0, Math.floor(fy * bm.height)));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bm, x, y, 1, 1, 0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return toHex(d[0], d[1], d[2]);
}

// the frame a video shows now, as a new PNG reference next to it (same tags and collections)
// src: a clip that is not a library file (a Pinterest video played from the web) — its blob: URL
export async function saveFrame(it, time, src) {
  const url = src || URL.createObjectURL(await fileBlob(it));
  try {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = url;
    await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('видео')); });
    v.currentTime = Math.min(time, Math.max(0, (v.duration || time) - 0.01));
    await new Promise((r) => { v.onseeked = r; });
    const png = await pngOf(v, v.videoWidth, v.videoHeight);
    const t = Math.floor(time), name = `${it.name} · ${tr('кадр')} ${Math.floor(t / 60)}-${String(t % 60).padStart(2, '0')}.png`;
    const out = await addFromBlobs([{ blob: png, name, source: it.url || '' }], { folder: it.folders[0] });
    out.forEach((n) => { n.tags = it.tags.slice(); n.folders = it.folders.slice(); });
    if (out.length) saveIndex();
    return out;
  } finally { if (!src) URL.revokeObjectURL(url); }
}

export async function copyFrame(it, time, src) {
  const url = src || URL.createObjectURL(await fileBlob(it));
  try {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = url;
    await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('видео')); });
    v.currentTime = Math.min(time, Math.max(0, (v.duration || time) - 0.01));
    await new Promise((r) => { v.onseeked = r; });
    await toClipboard(await pngOf(v, v.videoWidth, v.videoHeight));
  } finally { if (!src) URL.revokeObjectURL(url); }
}
