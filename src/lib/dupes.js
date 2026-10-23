// Duplicate finder.
// Exact copies: same size, then the same SHA-256 of the bytes (crypto.subtle). Only files whose size
// collides are read at all. Similar pictures: a 64-bit difference hash (dHash) of the thumbnail; two files
// are alike when at most PH_MAX of the 64 bits differ and their proportions match.
// Both hashes are cached in the item (`sha`, `phash` + `phashT` — optional fields, no migration needed):
// originals never change, so a second search only hashes new files.
import * as fs from '@tauri-apps/plugin-fs';
import { activeItems } from '../state.js';
import { absPath, assetUrl, saveIndex } from './library.js';
import { colorDist } from '../util.js';

const PH_MAX = 6;
const BIG = 300 * 1024 * 1024; // larger files are not read for the exact hash

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function sha(it) {
  if (it.sha) return it.sha;
  const u8 = await fs.readFile(absPath(it.file));
  it.sha = hex(await crypto.subtle.digest('SHA-256', u8));
  return it.sha;
}

// one big drawImage step aliases (fine stripes turn into noise), and different source sizes would blur
// differently: halve the picture step by step, then go through the same fixed sizes for every file
function shrink(img) {
  let src = img, w = img.width, h = img.height;
  const step = (nw, nh) => {
    const c = new OffscreenCanvas(nw, nh), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, nw, nh);
    src = c; w = nw; h = nh;
  };
  while (w > 128 || h > 128) step(Math.max(64, Math.ceil(w / 2)), Math.max(64, Math.ceil(h / 2)));
  step(64, 64); step(32, 32); step(16, 16);
  return src;
}

// dHash: the thumbnail shrunk to 9×8 grey pixels; each bit says whether a pixel is brighter than its right neighbour
let cv = null;
async function phash(it) {
  if (it.phash && it.phashT === it.thumb) return it.phash;
  const img = new Image();
  img.decoding = 'async';
  img.src = assetUrl(it.thumb);
  await img.decode();
  if (!cv) cv = new OffscreenCanvas(9, 8);
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, 9, 8);
  x.drawImage(shrink(img), 0, 0, 9, 8);
  const d = x.getImageData(0, 0, 9, 8).data;
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let k = 0; k < 8; k++) {
      const i = (y * 9 + k) * 4, j = i + 4;
      const a = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114, b = d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114;
      bits += a > b ? '1' : '0';
    }
  }
  it.phash = (parseInt(bits.slice(0, 32), 2) >>> 0).toString(16).padStart(8, '0') + (parseInt(bits.slice(32), 2) >>> 0).toString(16).padStart(8, '0');
  it.phashT = it.thumb;
  return it.phash;
}

// the dHash only sees light and shade: renders on the same backdrop look alike to it, so the palettes must agree too
function samePalette(a, b) {
  const A = a.colors.slice(0, 3), B = b.colors.slice(0, 3);
  if (!A.length || !B.length) return true;
  const d = A.reduce((s, c) => s + Math.min(...B.map((x) => colorDist(c, x))), 0) / A.length;
  return d < 40;
}

const pop = (n) => { n -= (n >>> 1) & 0x55555555; n = (n & 0x33333333) + ((n >>> 2) & 0x33333333); return (((n + (n >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24; };

// Finds groups. onProgress(done, total, stage). Returns { exact: [[item…]…], similar: [[item…]…], skipped }.
export async function findDuplicates(onProgress = () => {}) {
  const items = activeItems();
  let changed = false, skipped = 0;

  // 1. exact: only sizes that occur more than once
  const bySize = new Map();
  for (const it of items) { if (!it.size) continue; if (!bySize.has(it.size)) bySize.set(it.size, []); bySize.get(it.size).push(it); }
  const cand = [];
  bySize.forEach((list) => { if (list.length > 1) cand.push(...list); });
  const byHash = new Map();
  let done = 0;
  for (const it of cand) {
    if (it.size > BIG) { skipped++; done++; continue; }
    try {
      const had = !!it.sha;
      const h = await sha(it);
      if (!had) changed = true;
      const key = it.size + ':' + h;
      if (!byHash.has(key)) byHash.set(key, []);
      byHash.get(key).push(it);
    } catch (e) { console.warn('hash', it.file, e); skipped++; }
    if (++done % 8 === 0) onProgress(done, cand.length, 'exact');
  }
  const exact = Array.from(byHash.values()).filter((g) => g.length > 1);

  // 2. similar pictures by the thumbnail
  const pics = items.filter((it) => it.thumb && it.kind !== 'audio' && it.kind !== 'font');
  done = 0;
  const hs = [];
  for (const it of pics) {
    try {
      const had = it.phash && it.phashT === it.thumb;
      const h = await phash(it);
      if (!had) changed = true;
      hs.push([it, parseInt(h.slice(0, 8), 16) >>> 0, parseInt(h.slice(8), 16) >>> 0]);
    } catch (e) { /* no thumbnail on disk: skip */ }
    if (++done % 16 === 0) onProgress(done, pics.length, 'similar');
  }
  // union-find over close pairs
  const parent = hs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < hs.length; i++) {
    const [a, a1, a2] = hs[i];
    for (let j = i + 1; j < hs.length; j++) {
      const [b, b1, b2] = hs[j];
      if (pop(a1 ^ b1) + pop(a2 ^ b2) > PH_MAX) continue;
      if (Math.abs((a.ar || 1) - (b.ar || 1)) > 0.08 * Math.max(a.ar || 1, b.ar || 1)) continue;
      if (!samePalette(a, b)) continue;
      parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  hs.forEach(([it], i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
  // a "similar" group made only of copies of one file adds nothing to the exact groups
  const copyOf = new Map();
  exact.forEach((g, i) => g.forEach((x) => copyOf.set(x.id, i)));
  const similar = Array.from(groups.values()).filter((g) => g.length > 1 && !(copyOf.has(g[0].id) && g.every((x) => copyOf.get(x.id) === copyOf.get(g[0].id))));

  if (changed) saveIndex();
  return { exact, similar, skipped };
}

// Which copy to keep by default: exact copies — the one with the most metadata, then the oldest;
// similar — the largest picture, then the most metadata.
export function suggestKeep(group, exact) {
  const meta = (x) => x.tags.length + x.folders.length * 2 + (x.note ? 2 : 0) + (x.url ? 1 : 0) + (x.fav ? 3 : 0);
  return group.slice().sort((a, b) => exact
    ? meta(b) - meta(a) || a.added - b.added
    : (b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0) || meta(b) - meta(a) || a.added - b.added)[0];
}
