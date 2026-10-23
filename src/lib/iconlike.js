// «Похожие в библиотеке» for the icon constructor (plan item 5): while an icon is drawn, the SVG icons already in the
// library that have the same silhouette — so a second «Lock» is not drawn from scratch, and the weight of the set can be
// matched by eye. Shapes are compared, not positions: each picture becomes a 24×24 ink mask of its own bounding box
// (centred, aspect kept), and two masks are compared by soft IoU (Σ min / Σ max). Library masks come from the
// thumbnails (read through fs, so the canvas stays readable) and are cached by thumbnail path.
import { S } from '../state.js';
import { absPath } from './library.js';

const N = 24;
const cache = new Map(); // thumb path → mask | null

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = src; });
}
// any drawable → a normalised silhouette mask (dark on light, or opaque on transparent)
function maskOf(img) {
  const W = 96, c = document.createElement('canvas'); c.width = W; c.height = W;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, W);
  const k = Math.min(W / img.width, W / img.height);
  x.drawImage(img, (W - img.width * k) / 2, (W - img.height * k) / 2, img.width * k, img.height * k);
  const d = x.getImageData(0, 0, W, W).data, ink = new Float32Array(W * W);
  let x0 = W, y0 = W, x1 = -1, y1 = -1;
  for (let i = 0; i < W * W; i++) {
    const v = 1 - Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255; // any colour against the white ground (a yellow star too)
    ink[i] = v;
    if (v > 0.35) { const px = i % W, py = (i / W) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  }
  if (x1 < 0) return null;
  // Outline and Fill icons of one shape must match: everything the background cannot reach from the edge is inside
  // the silhouette (flood fill over the light pixels)
  const out = new Uint8Array(W * W), stack = [];
  for (let i = 0; i < W; i++) stack.push(i, (W - 1) * W + i, i * W, i * W + W - 1);
  while (stack.length) {
    const i = stack.pop();
    if (out[i] || ink[i] > 0.35) continue;
    out[i] = 1;
    const px = i % W, py = (i / W) | 0;
    if (px > 0) stack.push(i - 1); if (px < W - 1) stack.push(i + 1); if (py > 0) stack.push(i - W); if (py < W - 1) stack.push(i + W);
  }
  for (let i = 0; i < W * W; i++) if (!out[i]) ink[i] = 1;
  // the bounding box, centred in N×N with its aspect kept
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = (N - 2) / Math.max(bw, bh);
  const ox = (N - bw * s) / 2, oy = (N - bh * s) / 2;
  const m = new Float32Array(N * N), n = new Float32Array(N * N);
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const mx = Math.min(N - 1, Math.floor(ox + (px - x0) * s)), my = Math.min(N - 1, Math.floor(oy + (py - y0) * s));
    m[my * N + mx] += ink[py * W + px]; n[my * N + mx]++;
  }
  for (let i = 0; i < N * N; i++) m[i] = n[i] ? Math.min(1, m[i] / n[i] * 1.2) : 0;
  return m;
}
function iou(a, b) {
  let lo = 0, hi = 0;
  for (let i = 0; i < a.length; i++) { lo += Math.min(a[i], b[i]); hi += Math.max(a[i], b[i]); }
  return hi ? lo / hi : 0;
}

async function libraryMask(it) {
  const key = it.thumb;
  if (cache.has(key)) return cache.get(key);
  let m = null;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const ext = it.thumb.split('.').pop().toLowerCase();
    const type = { svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || '';
    const url = URL.createObjectURL(new Blob([await fs.readFile(absPath(it.thumb))], { type })); // an SVG decodes only with its type
    try { m = maskOf(await loadImage(url)); } finally { URL.revokeObjectURL(url); }
  } catch (e) { m = null; }
  cache.set(key, m);
  return m;
}

// the constructor's own icon (Fill path data on the 24 grid) against the library's SVG icons → [{ it, score }]
export async function similarIcons(fillPathData, { limit = 6, min = 0.6 } = {}) {
  if (!fillPathData) return [];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24"><path d="${fillPathData}" fill="#000" fill-rule="evenodd"/></svg>`;
  const mine = maskOf(await loadImage('data:image/svg+xml,' + encodeURIComponent(svg)));
  if (!mine) return [];
  // one entry per icon: the constructor saves ten files of one icon («Lock — Size=24, Style=Outline»…)
  const seen = new Set(), pool = [];
  for (const it of S.items) {
    if (it.trashed || it.ext !== 'svg' || !it.thumb) continue;
    const base = it.name.split(' — ')[0].trim().toLowerCase();
    if (seen.has(base)) continue;
    seen.add(base); pool.push(it);
    if (pool.length >= 400) break;
  }
  const out = [];
  for (const it of pool) {
    const m = await libraryMask(it);
    if (!m) continue;
    const score = iou(mine, m);
    if (score >= min) out.push({ it, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
