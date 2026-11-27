// «Эффекты»: a picture made retro, in two steps — a look (how the picture is drawn: as is, ANSI text, 1-bit, halftone)
// and a medium (what it is shown on: nothing, a CRT tube, a microfiche on a light table). This file is the math with no
// DOM (tests: tests/unit/effects.test.mjs); the drawing is lib/fxgl.js, the screen ui/effects.js.
// Every size is relative to the picture («символов по ширине»), so the preview and the saved file look the same.
//   LOOKS, MEDIA, CONTROLS, DEFAULTS   → what the panel shows, and its starting values
//   settle(stored)                     → a full, valid state from whatever was stored (prefs, an item's `effect`)
//   ansiCells / bitCells               → the per-cell data the shader draws (colour + glyph, or 0 / 1)
//   outSize, copyName                  → the saved file: at least 2048 px on the long side, «Имя · ANSI · CRT.png»

export const LOOKS = [
  { id: 'none', label: 'Как есть', tag: '' },
  { id: 'ansi', label: 'Текст ANSI', tag: 'ANSI' },
  { id: 'bit', label: '1 бит', tag: '1-bit' },
  { id: 'tone', label: 'Полутон', tag: 'Halftone' },
];
export const MEDIA = [
  { id: 'none', label: 'Нет', tag: '' },
  { id: 'crt', label: 'Кинескоп', tag: 'CRT' },
  { id: 'fiche', label: 'Микрофиша', tag: 'Fiche' },
];

// the panel: one row per control; `when` shows it only for that value of another control of the same effect
export const CONTROLS = {
  ansi: [
    { k: 'cols', label: 'Символов по ширине', type: 'range', min: 40, max: 240, step: 1, def: 100 },
    { k: 'set', label: 'Знаки', type: 'seg', opts: [['blocks', 'Блоки'], ['ascii', 'ASCII'], ['dots', 'Точки 5×5']], def: 'blocks' },
    { k: 'pal', label: 'Палитра', type: 'seg', opts: [['term16', '16 цветов'], ['accent', 'Ч/Б + акцент'], ['mono', 'Моно'], ['own', 'Свой цвет']], def: 'term16' },
    { k: 'accent', label: 'Акцент', type: 'color', def: '#ff3b30', when: ['pal', 'accent'] },
    { k: 'mono', label: 'Цвет', type: 'color', def: '#f2f2f2', when: ['pal', 'mono'] },
    { k: 'bg', label: 'Фон', type: 'seg', opts: [['dark', 'Тёмный'], ['light', 'Светлый']], def: 'dark' },
    { k: 'contrast', label: 'Контраст', type: 'range', min: 50, max: 200, step: 1, unit: '%', def: 120 },
  ],
  bit: [
    { k: 'method', label: 'Способ', type: 'seg', opts: [['bayer4', 'Bayer 4×4'], ['bayer8', 'Bayer 8×8'], ['fs', 'Floyd–Steinberg'], ['atkinson', 'Atkinson']], def: 'atkinson' },
    { k: 'dots', label: 'Точек по ширине', type: 'range', min: 80, max: 1200, step: 10, def: 320 },
    { k: 'pair', label: 'Цвета', type: 'seg', opts: [['bw', 'Чёрный / белый'], ['ink', 'Чернила / бумага'], ['blue', 'Синька'], ['lime', 'Лайм на чёрном'], ['own', 'Свои']], def: 'bw' },
    { k: 'dark', label: 'Тёмный', type: 'color', def: '#101010', when: ['pair', 'own'] },
    { k: 'light', label: 'Светлый', type: 'color', def: '#f4f1e8', when: ['pair', 'own'] },
    { k: 'bright', label: 'Яркость', type: 'range', min: -50, max: 50, step: 1, def: 0 },
    { k: 'contrast', label: 'Контраст', type: 'range', min: 50, max: 200, step: 1, unit: '%', def: 110 },
  ],
  tone: [
    { k: 'cells', label: 'Точек по ширине', type: 'range', min: 20, max: 200, step: 1, def: 70 },
    { k: 'angle', label: 'Угол', type: 'range', min: 0, max: 90, step: 1, unit: '°', def: 45 },
    { k: 'shape', label: 'Форма', type: 'seg', opts: [['dot', 'Круг'], ['line', 'Линия']], def: 'dot' },
    { k: 'ink', label: 'Цвет', type: 'seg', opts: [['mono', 'Чернила на бумаге'], ['cmyk', 'CMYK']], def: 'mono' },
  ],
  crt: [
    { k: 'phos', label: 'Люминофор', type: 'seg', opts: [['color', 'Цветной'], ['green', 'Зелёный'], ['amber', 'Янтарный'], ['white', 'Белый']], def: 'color' },
    { k: 'lines', label: 'Строк развёртки', type: 'range', min: 120, max: 900, step: 10, def: 360 },
    { k: 'bulge', label: 'Выпуклость', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 50 },
    { k: 'vig', label: 'Виньетка', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 50 },
    { k: 'grain', label: 'Зерно', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 30 },
    { k: 'glow', label: 'Свечение', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 35 },
    { k: 'around', label: 'Вокруг', type: 'seg', opts: [['black', 'Чёрный'], ['clear', 'Прозрачный']], def: 'black' },
  ],
  fiche: [
    { k: 'light', label: 'Подсветка', type: 'seg', opts: [['green', 'Зеленоватая'], ['cold', 'Холодная'], ['warm', 'Тёплая']], def: 'green' },
    { k: 'fall', label: 'Спад света', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 50 },
    { k: 'grain', label: 'Зерно плёнки', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 45 },
    { k: 'focus', label: 'Размытие фокуса', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 15 },
    { k: 'neg', label: 'Негатив', type: 'toggle', def: false },
    { k: 'marks', label: 'Метки совмещения', type: 'toggle', def: true },
    { k: 'label', label: 'Надпись: имя и дата', type: 'toggle', def: false },
  ],
};

const defsOf = (kind) => Object.fromEntries(CONTROLS[kind].map((c) => [c.k, c.def]));
// the first open is the aquirin look: ANSI text on a colour tube (Q10)
export const DEFAULTS = { look: 'ansi', media: 'crt', ...Object.fromEntries(Object.keys(CONTROLS).map((k) => [k, defsOf(k)])) };

const HEX = /^#[0-9a-f]{6}$/i;
function fitValue(c, v) {
  if (c.type === 'range') { const n = Number(v); return Number.isFinite(n) ? Math.min(c.max, Math.max(c.min, Math.round(n / c.step) * c.step)) : c.def; }
  if (c.type === 'seg') return c.opts.some(([id]) => id === v) ? v : c.def;
  if (c.type === 'color') return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : c.def;
  if (c.type === 'toggle') return typeof v === 'boolean' ? v : c.def;
  return c.def;
}
// a full state from whatever was stored: unknown keys dropped, ranges clamped, options and colours checked — another
// version or a broken value never reaches the shader
export function settle(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const out = {
    look: LOOKS.some((l) => l.id === s.look) ? s.look : DEFAULTS.look,
    media: MEDIA.some((m) => m.id === s.media) ? s.media : DEFAULTS.media,
  };
  for (const kind of Object.keys(CONTROLS)) {
    const v = s[kind] && typeof s[kind] === 'object' ? s[kind] : {};
    out[kind] = Object.fromEntries(CONTROLS[kind].map((c) => [c.k, fitValue(c, v[c.k])]));
  }
  return out;
}
// what a saved copy remembers: only the two effects it used (the `effect` field of the item)
export function snapshot(st) {
  const e = { look: st.look, media: st.media };
  if (CONTROLS[st.look]) e[st.look] = { ...st[st.look] };
  if (CONTROLS[st.media]) e[st.media] = { ...st[st.media] };
  return e;
}
export const hasEffect = (st) => st.look !== 'none' || st.media !== 'none';

// ——— colour ———
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
export function hexRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
// the classic 16 colours of a VGA text screen, darkest first in each half
export const TERM16 = [
  [0, 0, 0], [170, 0, 0], [0, 170, 0], [170, 85, 0], [0, 0, 170], [170, 0, 170], [0, 170, 170], [170, 170, 170],
  [85, 85, 85], [255, 85, 85], [85, 255, 85], [255, 255, 85], [85, 85, 255], [255, 85, 255], [85, 255, 255], [255, 255, 255],
].map((c) => c.map((v) => v / 255));
export function nearest(pal, r, g, b) {
  let best = pal[0], bd = Infinity;
  for (const c of pal) {
    // weighted by how the eye sees each channel, so a dark blue is not «closer» to black than to blue
    const d = 0.3 * (c[0] - r) ** 2 + 0.59 * (c[1] - g) ** 2 + 0.11 * (c[2] - b) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
// hue 0..1 and saturation 0..1
function hueSat(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-6) return [0, 0];
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6; if (h < 0) h += 1;
  return [h, d / mx];
}
export function cmyk(r, g, b) {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-6) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}
// contrast (percent) about the middle grey, then a shift (-50..50 → -0.5..0.5)
export const adjust = (v, contrast = 100, bright = 0) => clamp01((v - 0.5) * contrast / 100 + 0.5 + bright / 100);

// the colours a medium and the 1-bit pairs use (linear-free sRGB 0..1, the shader gets them as they are)
export const PAIRS = { bw: ['#000000', '#ffffff'], ink: ['#1d1c1a', '#f2ede3'], blue: ['#1d4f9e', '#eef4ff'], lime: ['#0b0c10', '#d7ff63'] };
export const PHOSPHOR = { green: '#41ff7a', amber: '#ffb000', white: '#e8f0ff' };
export const BACKLIGHT = { green: '#d9f2d2', cold: '#e3edf7', warm: '#f6ead2' };
export const PAPER = '#f4f1ea', INK = '#1a1a1a';
export function bitColors(p) {
  const [d, l] = p.pair === 'own' ? [p.dark, p.light] : PAIRS[p.pair] || PAIRS.bw;
  return [hexRgb(d), hexRgb(l)];
}

// ——— text mode ———
// glyphs from empty to full; «Точки» are the 5 × 5 dot matrices of the reference deck (same author), bit i = row * 5 + col
export const GLYPHS = {
  blocks: [' ', '░', '▒', '▓', '█'],
  ascii: [...' .:-=+*#%@'],
  dots: ['.....|.....|.....|.....|.....', '.....|.....|.....|.....|..#..', '.....|..#..|.....|..#..|.....', '.....|..#..|.###.|..#..|.....',
    '#...#|.#.#.|..#..|.#.#.|#...#', '.###.|#...#|#...#|#...#|.###.', '.#.#.|#####|.#.#.|#####|.#.#.', '#####|#####|#####|#####|#####']
    .map((g) => [...g.replace(/\|/g, '')].reduce((n, ch, i) => (ch === '#' ? n | (1 << i) : n), 0)),
};
export const glyphCount = (set) => (GLYPHS[set] || GLYPHS.blocks).length;

const DARK_BG = [0.04, 0.04, 0.05], LIGHT_BG = hexRgb(PAPER);
export const ansiBg = (p) => (p.bg === 'light' ? LIGHT_BG : DARK_BG);
// one cell: r, g, b (0..1, already over the background) → { g: glyph index, c: [r, g, b] the glyph's colour}.
// Brightness picks how much «paint» the cell gets (light on a dark screen, ink on paper); the colour is the cell's own
// hue at full strength, cut down to the palette
export function ansiCell(r, g, b, p, n = glyphCount(p.set)) {
  const light = p.bg === 'light';
  const l = adjust(luma(r, g, b), p.contrast);
  const paint = light ? 1 - l : l;
  const gi = Math.min(n - 1, Math.floor(paint * n));
  const m = Math.max(r, g, b, 1e-3), hue = [r / m, g / m, b / m];
  let c;
  if (p.pal === 'mono') c = hexRgb(p.mono);
  else if (p.pal === 'own') {
    // three levels per channel, like an old terminal (the reference); on paper a darker version, so it reads as ink
    const q = hue.map((v) => Math.round(v * 2) / 2);
    c = q.map((v) => v * (light ? 0.55 : 0.55 + 0.45 * l));
  } else if (p.pal === 'accent') {
    const [ah] = hueSat(...hexRgb(p.accent)), [h, s] = hueSat(r, g, b);
    const dh = Math.min(Math.abs(h - ah), 1 - Math.abs(h - ah));
    if (s > 0.35 && m > 0.2 && dh < 0.09) c = hexRgb(p.accent);
    else c = light ? (l < 0.45 ? [0.1, 0.1, 0.1] : [0.45, 0.45, 0.45]) : (l > 0.55 ? [0.95, 0.95, 0.95] : [0.55, 0.55, 0.55]);
  } else {
    // 16 colours: the hue at the brightness the cell has — dim cells get the dim half of the palette; black (white on
    // paper) never paints, it is the background. The hue is pushed to twice its saturation first: a pastel would
    // otherwise always land on grey, and the picture would lose its colours (a near-grey stays near grey)
    const grey = (hue[0] + hue[1] + hue[2]) / 3, vivid = hue.map((v) => clamp01(grey + (v - grey) * 2.2));
    const want = light ? vivid.map((v) => v * 0.6) : vivid.map((v) => v * (l > 0.5 ? 1 : 0.66));
    c = nearest(light ? TERM16.slice(0, 9) : TERM16.slice(1), ...want);
  }
  return { g: gi, c };
}
// a grid of cells: rgba (cols × rows, 0..255, straight alpha) → RGBA bytes: rgb — the glyph's colour, a — the glyph
export function ansiCells(rgba, cols, rows, p) {
  const out = new Uint8Array(cols * rows * 4), bg = ansiBg(p), n = glyphCount(p.set);
  for (let i = 0; i < cols * rows; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const r = rgba[i * 4] / 255 * a + bg[0] * (1 - a), g = rgba[i * 4 + 1] / 255 * a + bg[1] * (1 - a), b = rgba[i * 4 + 2] / 255 * a + bg[2] * (1 - a);
    const cell = ansiCell(r, g, b, p, n);
    out[i * 4] = Math.round(cell.c[0] * 255); out[i * 4 + 1] = Math.round(cell.c[1] * 255); out[i * 4 + 2] = Math.round(cell.c[2] * 255);
    out[i * 4 + 3] = cell.g;
  }
  return out;
}

// ——— 1-bit ———
// the ordered-dither matrix of size n (a power of two), as thresholds 0..1: bayer(4) is the classic 0, 8, 2, 10 …
export function bayer(n) {
  let m = [0];
  for (let s = 1; s < n; s *= 2) {
    const next = new Array(4 * s * s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const v = 4 * m[y * s + x];
      next[y * 2 * s + x] = v; next[y * 2 * s + x + s] = v + 2;
      next[(y + s) * 2 * s + x] = v + 3; next[(y + s) * 2 * s + x + s] = v + 1;
    }
    m = next;
  }
  return Float32Array.from(m, (v) => (v + 0.5) / (n * n));
}
export function ditherOrdered(lum, w, h, n) {
  const t = bayer(n), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = lum[y * w + x] > t[(y % n) * n + (x % n)] ? 1 : 0;
  return out;
}
// error diffusion: Floyd–Steinberg (serpentine — no diagonal «worms») passes on all the error; Atkinson passes on 6/8,
// so highlights and shadows stay clean, the Mac look
export function ditherDiffuse(lum, w, h, method) {
  const e = Float32Array.from(lum), out = new Uint8Array(w * h);
  const add = (x, y, v) => { if (x >= 0 && x < w && y < h) e[y * w + x] += v; };
  for (let y = 0; y < h; y++) {
    const back = method === 'fs' && y % 2 === 1, dx = back ? -1 : 1;
    for (let k = 0; k < w; k++) {
      const x = back ? w - 1 - k : k, i = y * w + x, v = e[i], o = v >= 0.5 ? 1 : 0, err = v - o;
      out[i] = o;
      if (method === 'fs') {
        add(x + dx, y, err * 7 / 16); add(x - dx, y + 1, err * 3 / 16); add(x, y + 1, err * 5 / 16); add(x + dx, y + 1, err / 16);
      } else {
        const q = err / 8;
        add(x + 1, y, q); add(x + 2, y, q); add(x - 1, y + 1, q); add(x, y + 1, q); add(x + 1, y + 1, q); add(x, y + 2, q);
      }
    }
  }
  return out;
}
export function dither(lum, w, h, method) {
  if (method === 'bayer4') return ditherOrdered(lum, w, h, 4);
  if (method === 'bayer8') return ditherOrdered(lum, w, h, 8);
  return ditherDiffuse(lum, w, h, method === 'fs' ? 'fs' : 'atkinson');
}
// a grid of dots: rgba (cols × rows, 0..255) → one byte per dot, 0 or 255 (transparent counts as the light colour)
export function bitCells(rgba, cols, rows, p) {
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < lum.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    lum[i] = adjust(luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) / 255 * a + (1 - a), p.contrast, p.bright);
  }
  const d = dither(lum, cols, rows, p.method), out = new Uint8Array(cols * rows);
  for (let i = 0; i < d.length; i++) out[i] = d[i] ? 255 : 0;
  return out;
}

// ——— sizes and names ———
// cells are square: `across` columns, as many rows as the picture's proportions give
export function gridOf(w, h, across) {
  const cols = Math.max(1, Math.round(across));
  return { cols, rows: Math.max(1, Math.round(cols * h / Math.max(1, w))) };
}
// the saved file: the original's size, at least 2048 px on the long side (scanlines and grain need room), at most
// 40 MP (a canvas that big still encodes; PNG ~60–120 MB)
export const MIN_LONG = 2048, MAX_PX = 40e6;
export function outSize(w, h) {
  w = Math.max(1, w || 1); h = Math.max(1, h || 1);
  let k = Math.max(1, MIN_LONG / Math.max(w, h));
  if (w * h * k * k > MAX_PX) k = Math.sqrt(MAX_PX / (w * h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
// «Постер.jpg» → «Постер · ANSI · CRT.png»; the tags are the same in both languages
export function copyName(name, look, media) {
  const base = String(name || 'Oddments').replace(/\.[^.]+$/, '');
  const tags = [LOOKS.find((l) => l.id === look), MEDIA.find((m) => m.id === media)].map((x) => x && x.tag).filter(Boolean);
  return `${base}${tags.map((t) => ' · ' + t).join('')}.png`;
}
// the grain's seed from the item's id: the same picture always gets the same grain, so saving twice gives one file
export function seedOf(id) {
  let h = 2166136261;
  for (const ch of String(id || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
