// Hiding personal data on a picture: the regions pii.js found (and any the person drew) are pixelated or filled
// on a copy. The original file is never touched — the copy goes into the library next to it, or out to an export.
//   findRegions(it)                 → { regions, url, ok } — OCR of the picture (ocr.js) → pii.js boxes (0..1)
//   maskToBlob(url, regions, mode)  → PNG Blob of the whole picture with the regions hidden
//   saveMaskedCopy(it, blob)        → the copy as a new library item: same collections and tags, `masked: true`
import { S } from '../state.js';
import { absPath, addFromBlobs, saveIndex } from './library.js';
import * as fs from '@tauri-apps/plugin-fs';
import { piiRegions, snapToGaps } from './pii.js';
import { t } from './i18n.js';

// the file the mask works on: the original picture, the PSD's full render
export function maskSource(it) {
  if (!it) return '';
  if (it.kind === 'image' && it.file && /\.(png|jpe?g|webp|bmp|avif|svg)$/i.test(it.file)) return it.file;
  if (it.preview) return it.preview;
  return '';
}
export const canMask = (it) => !!maskSource(it) && it.kind !== 'gif';

// the picture as our own blob: URL (read through fs — it stays valid while the window works on it, whatever the
// asset URL does meanwhile); the caller revokes it
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' };
export async function pictureUrl(it) {
  const src = maskSource(it), ext = (src.split('.').pop() || '').toLowerCase();
  const bytes = await fs.readFile(absPath(src));
  return URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || 'image/png' }));
}
// → { url (revoke it when done), lines, regions, ok, why }
export async function findRegions(it, opts) {
  const src = maskSource(it);
  return findRegionsAt(await pictureUrl(it), /\.svg$/i.test(src), opts);
}
// ok: false with why 'off' — the text reader is switched off (Settings › ИИ), nothing could be found
export async function findRegionsAt(url, svg = false, { sums = true } = {}) {
  let lines = [], ok = true, why = '';
  try {
    const ocr = await import('./ocr.js');
    if (!ocr.ocrOn()) { ok = false; why = 'off'; } else lines = (await ocr.readLines(url, svg)).lines;
  } catch (e) { ok = false; why = (e && e.message) || String(e); }
  let regions = piiRegions(lines, { sums });
  if (regions.length) regions = await snapAll(url, regions).catch(() => regions);
  return { url, lines, regions, ok, why };
}

// each region's edges moved to the real gaps between words of its line (pii.js snapToGaps)
async function snapAll(url, regions) {
  const img = await loadImage(url);
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return regions.map((r) => {
    const lx = Math.max(0, Math.floor((r.lx ?? r.x) * W)), lw = Math.max(1, Math.min(W - lx, Math.ceil((r.lw ?? r.w) * W)));
    const y = Math.max(0, Math.floor(r.y * H)), h = Math.max(1, Math.min(H - y, Math.ceil(r.h * H)));
    const d = g.getImageData(lx, y, lw, h).data;
    // the background: the colour most of the line's corners have
    const bg = [d[0], d[1], d[2]];
    const ink = new Uint8Array(lw);
    for (let x = 0; x < lw; x++) {
      for (let yy = 0; yy < h; yy++) {
        const o = (yy * lw + x) * 4;
        if (Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) > 90) { ink[x] = 1; break; }
      }
    }
    const [a, b] = snapToGaps(ink, r.x * W - lx, (r.x + r.w) * W - lx, h);
    return { ...r, x: (lx + a) / W, w: (b - a) / W };
  });
}

// a picture not yet in the library (a frame of a screen recording): hidden where needed → { blob, n, ok }
export async function maskBlobAuto(blob, mode = 'pixel') {
  const url = URL.createObjectURL(blob);
  try {
    const f = await findRegionsAt(url);
    if (!f.regions.length) return { blob, n: 0, ok: f.ok };
    return { blob: await maskToBlob(url, f.regions, mode), n: f.regions.length, ok: true };
  } finally { URL.revokeObjectURL(url); }
}

async function loadImage(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return img;
}

// one region in pixels, a little larger than the text box (OCR boxes hug the letters)
const px = (r, W, H) => {
  const pad = Math.max(2, r.h * H * 0.12);
  const x = Math.max(0, r.x * W - pad), y = Math.max(0, r.y * H - pad);
  return { x, y, w: Math.min(W - x, r.w * W + pad * 2), h: Math.min(H - y, r.h * H + pad * 2) };
};

// pixelate: blocks a third of the line's height — digits and letters cannot be told apart, the place still reads as
// «text was here»; fill: the region's edge colour, like an empty field
export function paint(g, src, regions, mode = 'pixel') {
  const W = g.canvas.width, H = g.canvas.height;
  for (const r of regions) {
    const b = px(r, W, H);
    if (b.w < 1 || b.h < 1) continue;
    if (mode === 'fill') {
      const d = g.getImageData(Math.round(b.x), Math.round(b.y), Math.max(1, Math.round(b.w)), Math.max(1, Math.round(b.h))).data;
      const w = Math.max(1, Math.round(b.w)), h = Math.max(1, Math.round(b.h));
      let rs = 0, gs = 0, bs = 0, n = 0;
      for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const o = (y * w + x) * 4; rs += d[o]; gs += d[o + 1]; bs += d[o + 2]; n++; }
      g.fillStyle = `rgb(${Math.round(rs / n)}, ${Math.round(gs / n)}, ${Math.round(bs / n)})`;
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, Math.min(b.h / 2, 8));
      g.fill();
    } else {
      const block = Math.max(6, b.h / 3);
      const tw = Math.max(1, Math.round(b.w / block)), th = Math.max(1, Math.round(b.h / block));
      const t = new OffscreenCanvas(tw, th), tg = t.getContext('2d');
      tg.imageSmoothingEnabled = true;
      tg.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, tw, th);
      g.save();
      g.imageSmoothingEnabled = false;
      g.drawImage(t, 0, 0, tw, th, b.x, b.y, b.w, b.h);
      g.restore();
    }
  }
}

export async function maskToBlob(url, regions, mode = 'pixel') {
  const img = await loadImage(url);
  const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: mode === 'fill' });
  g.drawImage(img, 0, 0);
  paint(g, img, regions, mode);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('картинка не сохранилась'))), 'image/png'));
}

export async function saveMaskedCopy(it, blob) {
  const base = it.name.replace(/\.[^.]+$/, '');
  const [copy] = await addFromBlobs([{ blob, name: `${base} — ${t('без личных данных')}.png`, source: it.url || '' }], { folder: (it.folders || [])[0] || null });
  if (!copy) return null;
  copy.folders = [...new Set([...(copy.folders || []), ...(it.folders || [])])];
  copy.tags = [...new Set([...(copy.tags || []), ...(it.tags || [])])];
  copy.masked = true; // a hidden-data copy: no mark, and the team library takes it (team.js)
  copy.maskOf = it.id;
  delete copy.pii;
  saveIndex();
  return copy;
}

// a library item's id → the copy made from it, if one exists (the inspector says «Копия без личных данных есть»)
export const maskedCopyOf = (it) => S.items.find((x) => x.maskOf === it.id && !x.trashed) || null;
