// The palette of a picture (#79). The old one counted pixels in 512 coarse RGB boxes of a 40 px copy and kept the five
// most frequent: the background ate the palette, small bright accents vanished, colours came out muddy. Here:
// a 96 px copy → OKLab (perceptual: equal steps look equal) → k-means → near clusters merged → the background found by
// the picture's border goes last → the most colourful small cluster gets a place (the accent) → up to 5 colours with
// their shares. Search by colour measures in OKLab too (`okDist`).
import { toHex } from '../util.js';

export const PALETTE_V = 2; // items extracted with this version carry `palV: 2` (older ones are refreshed in the background)

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toLab(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function toRgb(L, A, B) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
const hexLab = (h) => toLab(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const chroma = (c) => Math.hypot(c[1], c[2]);
const labCache = new Map();
// OKLab distance between two hex colours: 0 = same, ~0.02 = barely, ~0.1 = clearly different, 1 = black–white
export function okDist(a, b) {
  let x = labCache.get(a); if (!x) { x = hexLab(a); labCache.set(a, x); }
  let y = labCache.get(b); if (!y) { y = hexLab(b); labCache.set(b, y); }
  return Math.sqrt(d2(x, y));
}

// → { colors: ['#rrggbb', …], shares: [0..1, …], bg: index of the background or -1 }
export function extractPalette(source) {
  const W = 96;
  const sw = source.width || source.naturalWidth || W, sh = source.height || source.naturalHeight || W;
  const c = document.createElement('canvas');
  c.width = W; c.height = Math.max(1, Math.round((W * sh) / sw));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(source, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height;
  const px = [], border = [];
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const o = (y * w + i) * 4;
    if (d[o + 3] < 128) continue;
    const lab = toLab(d[o], d[o + 1], d[o + 2]);
    px.push(lab);
    if (y < 2 || y >= h - 2 || i < 2 || i >= w - 2) border.push(px.length - 1);
  }
  if (!px.length) return { colors: [], shares: [], bg: -1 };
  // k-means, seeded by «farthest first» from the median lightness (deterministic: the same picture, the same palette)
  const K = Math.min(16, px.length);
  const step = Math.max(1, Math.floor(px.length / 4000)); // seeds and passes over a sample, the final counts over all
  const sample = px.filter((_, i) => i % step === 0);
  const cs = [sample[Math.floor(sample.length / 2)].slice()];
  const near = new Float64Array(sample.length).fill(Infinity);
  while (cs.length < K) {
    let best = -1, bi = 0;
    for (let i = 0; i < sample.length; i++) { near[i] = Math.min(near[i], d2(sample[i], cs[cs.length - 1])); if (near[i] > best) { best = near[i]; bi = i; } }
    if (best < 1e-5) break;
    cs.push(sample[bi].slice());
  }
  const assign = (p) => { let b = 0, bd = Infinity; for (let k = 0; k < cs.length; k++) { const v = d2(p, cs[k]); if (v < bd) { bd = v; b = k; } } return b; };
  for (let it = 0; it < 10; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const p of sample) { const k = assign(p), s = sum[k]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; }
    let moved = 0;
    sum.forEach((s, k) => { if (s[3]) { const n = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; moved += d2(n, cs[k]); cs[k] = n; } });
    if (moved < 1e-7) break;
  }
  // final counts over every pixel, and how much of the border each cluster holds
  const cnt = new Array(cs.length).fill(0), bcnt = new Array(cs.length).fill(0), lab = cs.map(() => [0, 0, 0]);
  const own = new Int32Array(px.length);
  px.forEach((p, i) => { const k = assign(p); own[i] = k; cnt[k]++; lab[k][0] += p[0]; lab[k][1] += p[1]; lab[k][2] += p[2]; });
  for (const i of border) bcnt[own[i]]++;
  let cl = cs.map((_, k) => ({ lab: cnt[k] ? lab[k].map((v) => v / cnt[k]) : cs[k], n: cnt[k], b: bcnt[k] })).filter((q) => q.n);
  // merge clusters that look the same (ΔE_ok < 0.045)
  cl.sort((a, b) => b.n - a.n);
  for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
    if (Math.sqrt(d2(cl[i].lab, cl[j].lab)) < 0.045) {
      const a = cl[i], b = cl[j], n = a.n + b.n;
      a.lab = a.lab.map((v, t) => (v * a.n + b.lab[t] * b.n) / n); a.n = n; a.b += b.b;
      cl.splice(j, 1); j--;
    }
  }
  const total = px.length;
  cl.forEach((q) => { q.share = q.n / total; q.c = chroma(q.lab); });
  // the background: the cluster that holds most of the border, if it holds over half of it and a good part of the picture
  const bt = border.length || 1;
  const bgc = cl.reduce((m, q) => (q.b > (m ? m.b : 0) ? q : m), null);
  const bg = bgc && bgc.b / bt > 0.5 && bgc.share > 0.15 ? bgc : null;
  // order: by share, colourful clusters weigh a little more (a saturated 10 % beats a grey 12 %); background last
  const score = (q) => q.share * (1 + 2.5 * q.c);
  // greedy, with variety: a colour joins only if it differs clearly (ΔE_ok ≥ 0.09) from those already taken —
  // otherwise four shades of one teal filled the palette and a light detail had no place
  const list = cl.filter((q) => q !== bg && q.share >= 0.008).sort((a, b) => score(b) - score(a));
  const room = bg ? 4 : 5, pick = [];
  for (const q of list) {
    if (pick.length >= room) break;
    if (pick.every((p) => Math.sqrt(d2(p.lab, q.lab)) >= 0.09) && (!bg || Math.sqrt(d2(bg.lab, q.lab)) >= 0.06)) pick.push(q);
  }
  // places left: small but distinct colours (a light highlight, a muted pink) — a looser bar, smaller shares
  const rest = cl.filter((q) => q !== bg && !pick.includes(q) && q.share >= 0.003).sort((a, b) => score(b) - score(a));
  for (const q of rest) {
    if (pick.length >= room) break;
    if (pick.every((p) => Math.sqrt(d2(p.lab, q.lab)) >= 0.07) && (!bg || Math.sqrt(d2(bg.lab, q.lab)) >= 0.06)) pick.push(q);
  }
  // the accent: the most colourful small cluster gets a place if the five missed it
  // the accent: k-means averages a small bright patch with its neighbours into a duller colour, so it is looked for
  // directly — the most colourful patch on a fine grid of shades covering at least 1.5 % of the picture
  const bins = new Map();
  for (const q of px) {
    const ch = Math.hypot(q[1], q[2]);
    if (ch < 0.09) continue;
    const k = Math.round(q[0] * 10) + ':' + Math.round(q[1] * 14) + ':' + Math.round(q[2] * 14);
    const e = bins.get(k) || { n: 0, s: [0, 0, 0] };
    e.n++; e.s[0] += q[0]; e.s[1] += q[1]; e.s[2] += q[2];
    bins.set(k, e);
  }
  const acc = [...bins.values()].filter((e) => e.n / total >= 0.015).map((e) => { const m = e.s.map((v) => v / e.n); return { lab: m, c: Math.hypot(m[1], m[2]), n: e.n, share: e.n / total }; })
    .sort((a, b) => b.c - a.c)[0];
  if (acc && pick.every((p) => Math.sqrt(d2(p.lab, acc.lab)) >= 0.08)) {
    if (pick.length >= room) pick.pop();
    pick.push(acc);
  }
  if (bg) pick.push(bg);
  const colors = pick.map((q) => { const [r, g, b] = toRgb(...q.lab); return toHex(r, g, b); });
  return { colors, shares: pick.map((q) => +q.share.toFixed(3)), bg: bg ? pick.length - 1 : -1 };
}
