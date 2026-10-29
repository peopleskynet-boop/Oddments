// Pixels of a library file for the right-click menus: copy the picture, read the colour under the cursor,
// keep a video frame as a new reference. The file is read through fs (like the rest of the library) and drawn
// from a blob: URL, so the canvas stays readable (an asset:// image would taint it).
import * as fs from '@tauri-apps/plugin-fs';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { absPath, addFromBlobs, saveIndex } from '../lib/library.js';
import { MIME } from '../state.js';
import { toHex } from '../util.js';
import { t as tr } from '../lib/i18n.js'; // `t` is the frame's time here

export async function fileBlob(it, rel = it.file) {
  return new Blob([await fs.readFile(absPath(rel))], { type: MIME[it.ext] || '' });
}

async function bitmapOf(it) {
  const rel = it.kind === 'psd' && it.preview ? it.preview : it.kind === 'image' || it.kind === 'gif' ? it.file : it.thumb;
  if (!rel) throw new Error('нет картинки');
  return createImageBitmap(await fileBlob(it, rel));
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
