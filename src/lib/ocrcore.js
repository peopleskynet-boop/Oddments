// Text on pictures (OCR) — the math around PaddleOCR PP-OCRv5 (Apache 2.0): text detection (DB, mobile) finds
// the lines, recognition (East Slavic mobile: Russian, Ukrainian, Belarusian, Bulgarian + English) reads them.
// No DOM here: pictures come in as RGBA ImageData-like objects, so the same code runs in the worker and in tests.
// Only horizontal text is read (screenshots, posters, UI) — boxes are axis-aligned.

const DET_LONG = 960; // PaddleOCR's DetResizeForTest resize_long
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
export const REC_H = 48;
const REC_MAX_W = 1600;

// bilinear resize of an RGBA picture
export function resize(img, w, h) {
  const { data: s, width: sw, height: sh } = img;
  const d = new Uint8ClampedArray(w * h * 4);
  const kx = sw / w, ky = sh / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, (y + 0.5) * ky - 0.5), y0 = Math.min(sh - 1, fy | 0), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, (x + 0.5) * kx - 0.5), x0 = Math.min(sw - 1, fx | 0), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, e = (y1 * sw + x1) * 4, o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) d[o + k] = (s[a + k] * (1 - tx) + s[b + k] * tx) * (1 - ty) + (s[c + k] * (1 - tx) + s[e + k] * tx) * ty;
    }
  }
  return { data: d, width: w, height: h };
}

// the picture over white (transparent PNG/SVG text would vanish on black)
export function flatten(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 1) { d[i] = d[i] * a + 255 * (1 - a); d[i + 1] = d[i + 1] * a + 255 * (1 - a); d[i + 2] = d[i + 2] * a + 255 * (1 - a); d[i + 3] = 255; }
  }
  return img;
}

// detection input: long side ≤ 960 (small pictures are enlarged to at least 640 — tiny text is lost otherwise),
// both sides multiples of 32, BGR order as the model was trained, ImageNet mean/std
export function detInput(img, maxLong = DET_LONG) {
  const long = Math.max(img.width, img.height);
  const k = long > maxLong ? maxLong / long : long < 640 ? 640 / long : 1;
  const w = Math.max(32, Math.round((img.width * k) / 32) * 32), h = Math.max(32, Math.round((img.height * k) / 32) * 32);
  const r = resize(img, w, h), n = w * h, x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // channel 0 = B, 1 = G, 2 = R (DecodeImage img_mode BGR)
    x[i] = (r.data[o + 2] / 255 - MEAN[0]) / STD[0];
    x[n + i] = (r.data[o + 1] / 255 - MEAN[1]) / STD[1];
    x[2 * n + i] = (r.data[o] / 255 - MEAN[2]) / STD[2];
  }
  return { x, w, h, sx: img.width / w, sy: img.height / h };
}

// DB post-processing: probability map → boxes (in the source picture's pixels). Connected regions over the 0.3
// threshold, kept when their mean probability ≥ 0.6, then grown by area·1.5/perimeter (PaddleOCR's unclip).
export function detBoxes(prob, w, h, sx, sy, { thresh = 0.3, boxThresh = 0.6, unclip = 1.5 } = {}) {
  const seen = new Uint8Array(w * h), out = [], stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || prob[i] <= thresh) continue;
    let sp = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, sum = 0, cnt = 0;
    stack[sp++] = i; seen[i] = 1;
    while (sp) {
      const p = stack[--sp], px = p % w, py = (p / w) | 0;
      sum += prob[p]; cnt++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      const nb = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && !seen[q] && prob[q] > thresh) { seen[q] = 1; stack[sp++] = q; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < 3 || sum / cnt < boxThresh) continue;
    const d = (bw * bh * unclip) / (2 * (bw + bh));
    const bx0 = Math.max(0, (x0 - d) * sx), by0 = Math.max(0, (y0 - d) * sy);
    const bx1 = Math.min(w * sx, (x1 + 1 + d) * sx), by1 = Math.min(h * sy, (y1 + 1 + d) * sy);
    if (by1 - by0 < 6 || bx1 - bx0 < 6) continue;
    out.push({ x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, score: sum / cnt });
  }
  return order(out);
}

// reading order: rows top to bottom (boxes whose middles are within half a line height share a row), left to right
export function order(boxes) {
  const b = boxes.slice().sort((p, q) => p.y + p.h / 2 - (q.y + q.h / 2));
  const rows = [];
  for (const x of b) {
    const m = x.y + x.h / 2, row = rows.find((r) => Math.abs(r.m - m) < Math.min(r.h, x.h) / 2);
    if (row) { row.items.push(x); row.m = (row.m * (row.items.length - 1) + m) / row.items.length; } else rows.push({ m, h: x.h, items: [x] });
  }
  return rows.flatMap((r, ri) => r.items.sort((p, q) => p.x - q.x).map((x) => ({ ...x, row: ri })));
}

// one crop for recognition: height 48, width by aspect (≤ 1600), RGB→BGR, (x/255 − 0.5)/0.5
export function recCrop(img, box) {
  const x0 = Math.floor(box.x), y0 = Math.floor(box.y), cw = Math.max(1, Math.ceil(box.w)), ch = Math.max(1, Math.ceil(box.h));
  const c = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const sy = Math.min(img.height - 1, y0 + y);
    for (let x = 0; x < cw; x++) {
      const sx = Math.min(img.width - 1, x0 + x), s = (sy * img.width + sx) * 4, o = (y * cw + x) * 4;
      c[o] = img.data[s]; c[o + 1] = img.data[s + 1]; c[o + 2] = img.data[s + 2]; c[o + 3] = 255;
    }
  }
  const w = Math.max(8, Math.min(REC_MAX_W, Math.round((REC_H * cw) / ch)));
  return { img: resize({ data: c, width: cw, height: ch }, w, REC_H), w };
}

// a batch of crops padded to the widest (padding = 0 after normalisation, as PaddleOCR does)
export function recBatch(crops) {
  const W = Math.max(...crops.map((c) => c.w)), n = REC_H * W, x = new Float32Array(crops.length * 3 * n);
  crops.forEach((c, b) => {
    const base = b * 3 * n, d = c.img.data;
    for (let y = 0; y < REC_H; y++) for (let i = 0; i < c.w; i++) {
      const o = (y * c.w + i) * 4, p = y * W + i;
      x[base + p] = d[o + 2] / 127.5 - 1;
      x[base + n + p] = d[o + 1] / 127.5 - 1;
      x[base + 2 * n + p] = d[o] / 127.5 - 1;
    }
  });
  return { x, W };
}

// CTC greedy decoding: class 0 is the blank, then the dictionary, then a space
export function ctcDecode(out, batch, steps, classes, dict) {
  const res = [];
  for (let b = 0; b < batch; b++) {
    let text = '', prev = -1, conf = 0, cnt = 0;
    for (let t = 0; t < steps; t++) {
      const o = (b * steps + t) * classes;
      let best = 0, bv = -Infinity;
      for (let k = 0; k < classes; k++) if (out[o + k] > bv) { bv = out[o + k]; best = k; }
      if (best !== 0 && best !== prev) { text += best - 1 < dict.length ? dict[best - 1] : ' '; conf += bv; cnt++; }
      prev = best;
    }
    res.push({ text: text.trim(), conf: cnt ? conf / cnt : 0 });
  }
  return res;
}

// The model reads Cyrillic and Latin with one alphabet, so look-alike letters get mixed inside a word («Нотe», «НеІр»
// for Home, Help). A word with letters of both scripts is put into the script most of its letters are in.
const LAT = 'ABCEHIKMOPTXaceiopxyJjSsQqWw', CYR = 'АВСЕНІКМОРТХасеіорхуЈјЅѕԚԛԜԝ';
const toCyr = new Map([...LAT].map((c, i) => [c, CYR[i]])), toLat = new Map([...CYR].map((c, i) => [c, LAT[i]]));
toLat.set('и', 'u'); toLat.set('п', 'n'); toLat.set('т', 'm');
export function fixScripts(s) {
  return s.replace(/[\p{L}]+/gu, (w) => {
    // letters only one alphabet has (ф, н, ж… / f, h, g…) decide; look-alikes alone go by the majority
    let c = 0, l = 0, cs = 0, ls = 0;
    for (const ch of w) {
      if (/\p{Script=Cyrillic}/u.test(ch)) { c++; if (!toLat.has(ch)) cs++; } else if (/\p{Script=Latin}/u.test(ch)) { l++; if (!toCyr.has(ch)) ls++; }
    }
    if (!c || !l || (cs && ls)) return w;
    const map = cs ? toCyr : ls ? toLat : c > l ? toCyr : toLat;
    return [...w].map((ch) => map.get(ch) || ch).join('');
  });
}

// what is worth keeping from a line: sure enough, and with at least two letters or digits (single «x», «t», «0»
// read from icons and textures are noise)
export const goodLine = (r) => r.conf >= 0.75 && (r.text.match(/[\p{L}\p{N}]/gu) || []).length >= 2;

// lines → plain text: boxes of one row joined with spaces, rows with new lines
export function joinLines(items) {
  const rows = [];
  for (const it of items) (rows[it.row] || (rows[it.row] = [])).push(fixScripts(it.text));
  return rows.filter(Boolean).map((r) => r.join(' ')).join('\n').trim();
}
