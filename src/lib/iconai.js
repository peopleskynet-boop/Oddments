// Icon generation by request (bug #117, redone): a language model (Anthropic API, the key the person puts in Settings)
// draws a plain 24-grid SVG — what models know well, Lucide-like lines and shapes — and Oddments turns it into the
// library's style with the same code as «Стилизовать SVG» (K.stylize + K.fixToRules): silhouette, the size's line,
// soft corners, keylines, the pixel grid. So the rules are kept by code, not by the model's good will.
// Examples are the person's own icons: library files tagged «пример иконки» (the Figma plugin sends a whole icon file
// that way) and icons saved from the constructor; per request the nearest by name and words go into the prompt, the
// constant part (rules + style samples) is cached. Then a second pass: every variant is drawn to a picture and shown
// back to the model, which says whether it matches the request and redraws the ones that do not.
// Only the request, the examples and the variants' pictures leave the computer; the rest of the library does not.
import { EXAMPLES } from './iconai-examples.js';

// the Anthropic key and the model — shared with the AI through the API (aicloud.js), kept in a small module of their own
export { MODELS, aiPrefs, setAiPrefs } from './anthropickey.js';
import { aiPrefs } from './anthropickey.js';
import { lang } from './i18n.js';

// the tag the Figma plugin puts on icons sent as examples (any file with it counts, so a folder of SVGs works too)
export const EX_TAG = 'пример иконки';

const SYSTEM = `You design interface icons for a product design system. You draw each icon as a small SVG on a 24×24 grid;
the design system's tool then converts your drawing into its exact style, so draw the IDEA clearly and simply.

HOW YOUR SVG IS CONVERTED (draw for this):
- Closed contours (filled shapes, or closed stroked outlines like a rounded rectangle or a circle) become the solid
  SILHOUETTE. The library publishes Fill (the silhouette) and Outline (the silhouette with a 2 px inner contour).
- Open stroked lines (a door, a check mark, an arrow, a wave) become 2 px round-capped lines; inside the silhouette
  they are inner details.
- The whole drawing is scaled into a keyline (square 18, rectangles 16×20 or 20×16), centred, corners softened.

DRAW LIKE THIS: viewBox="0 0 24 24", stroke="currentColor" stroke-width="2" stroke-linecap="round"
stroke-linejoin="round" fill="none" for lines; fill="currentColor" with no stroke for solid areas. Use <path>, <rect rx>,
<circle>, <ellipse>, <line>, <polyline>. One clear object or metaphor, a few big parts, no tiny details, no text or
letters (unless the letter is the meaning), no perspective, no gradients, no transforms you do not need. Keep 2 px of
air between separate parts and never make a part or a gap thinner than 2 px. Prefer horizontal, vertical and 45° lines.

ANSWER FORMAT. Only JSON, no prose:
{"variants":[{"name":"Name Name","keys":"English, words, Русские, слова","idea":"one short sentence in Russian","svg":"<svg …>…</svg>"}]}
"name" is in Latin script, Title Case, plain (e.g. "Smart Lamp"); "keys" are search words in English and Russian.
Make the variants genuinely different metaphors or compositions, not small tweaks of one.`;

const REVIEW = `You check icon drafts for a design system. You get the request and pictures of the drafts (black on white,
as the library will show them). For each draft decide: does a person see the requested thing at a glance, with no
stray, meaningless or broken parts (a letter inside a house, a loose blob, a cut that splits the object)?
Answer only JSON: {"reviews":[{"i":0,"ok":true,"why":"${lang === 'en' ? 'short, in English' : 'коротко по-русски'}"}, …]}. For a draft that is not ok also give
"svg": a corrected drawing on the 24 grid, same conventions as before (stroke 2, round caps, fill="currentColor" for solid areas).`;

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

async function call(body) {
  const { key } = aiPrefs();
  // the browser-access opt-in always: the exe's HTTP plugin sends an Origin header too (bug #110)
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  const f = inApp() ? (await import('@tauri-apps/plugin-http')).fetch : fetch;
  const r = await f('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || 'HTTP ' + r.status;
    throw new Error(r.status === 401 ? 'ключ API не подошёл' : r.status === 429 ? 'слишком много запросов, попробуйте через минуту' : msg);
  }
  return { text: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''), usage: j.usage || null };
}

/* ---------- examples: the person's icons ---------- */
// an SVG made short for the prompt: no metadata, ids, classes or styles, numbers to one decimal
export function compactSvg(text) {
  return String(text)
    .replace(/<\?xml[^>]*>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, '')
    .replace(/<(title|desc|metadata|defs)[\s\S]*?<\/\1>/g, '')
    .replace(/\s(id|class|style|data-[\w-]+|xmlns:\w+|xml:space)="[^"]*"/g, '')
    .replace(/-?\d+\.\d{2,}/g, (n) => String(Math.round(+n * 10) / 10))
    .replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"')
    .replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
}
const words = (s) => String(s || '').toLowerCase().replace(/[_\-—,.;:()/«»"]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);
// a word matches when one starts the other (лампа / лампочка, lock / locked) — enough for names and tags
const near = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, Math.max(4, b.length - 2))) || b.startsWith(a.slice(0, Math.max(4, a.length - 2)))));

// library icons that can serve as examples: tagged «пример иконки», or saved by the constructor (one per icon: the 24 Outline)
export function exampleItems(items) {
  const out = new Map();
  for (const it of items || []) {
    if (it.trashed || (it.ext || '').toLowerCase() !== 'svg') continue;
    const tags = it.tags || [];
    const mine = tags.includes(EX_TAG);
    const saved = tags.includes('иконка') && /Size=24\b/.test(it.name || '') && !/Style=Fill/.test(it.name || '');
    if (!mine && !saved) continue;
    // «Lock — замок, защита» (the plugin puts the Figma description after the name); «… — Size=24, Style=Outline» is not words
    const [base, ...rest] = String(it.name || '').replace(/\.svg$/i, '').split(' — ');
    const name = base.trim(), more = rest.filter((r) => !/Size=\d/.test(r)).join(' ');
    if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), { it, name, tags: [...tags.filter((t) => t !== EX_TAG && t !== 'иконка'), ...(more ? [more] : [])] });
  }
  return [...out.values()];
}
// the nearest examples to a request: words of the name and tags against the request's words, then the rest in order
export function pickExamples(list, request, k = 24) {
  const q = words(request);
  const score = (e) => { const w = words(e.name + ' ' + e.tags.join(' ')); return q.reduce((s, a) => s + (w.some((b) => near(a, b)) ? 1 : 0), 0); };
  return list.map((e, i) => ({ e, s: score(e), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, k).map((x) => x.e);
}

async function libraryExamples(request) {
  let list = [];
  try { const { S } = await import('../state.js'); list = exampleItems(S.items); } catch (e) { list = []; }
  if (!list.length) return { picked: [], total: 0 };
  const fs = await import('@tauri-apps/plugin-fs');
  const { absPath } = await import('./library.js');
  const picked = [];
  for (const e of pickExamples(list, request, 30)) {
    try {
      const svg = compactSvg(await fs.readTextFile(absPath(e.it.file)));
      if (svg.length < 6000) picked.push({ name: e.name, keys: e.tags.join(', '), svg });
    } catch (er) { /* a missing file is skipped */ }
    if (picked.length >= 24) break;
  }
  return { picked, total: list.length };
}
// without the person's icons: the hand-built samples, drawn as the library draws them
async function builtinExamples() {
  const K = await import('./iconkit.js');
  return EXAMPLES.map((e) => ({ name: e.name, keys: e.keys, svg: `<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="${K.build(e.shapes, 24).fill}"/></svg>` }));
}
const exText = (list) => list.map((e) => `${e.name}${e.keys ? ` (${e.keys})` : ''}: ${e.svg}`).join('\n');

/* ---------- variants: SVG → the library's style ---------- */
export function parseJson(text, field) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('модель ответила не в том формате');
  let data;
  try { data = JSON.parse(m[0]); } catch (e) { throw new Error('модель прислала битый JSON'); }
  return Array.isArray(data[field]) ? data[field] : [];
}
async function toVariant(v) {
  const K = await import('./iconkit.js');
  const svg = String(v.svg || '');
  if (!/<svg[\s>]/i.test(svg)) return null;
  let r;
  // the parser does not know currentColor: plain black, the namespace if the model left it out
  const src = svg.replace(/currentColor/g, '#000');
  try { r = K.stylize(src.includes('xmlns') ? src : src.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')); } catch (e) { return null; }
  if (!r.shapes.length) return null;
  const shapes = K.fixToRules(r.shapes).shapes;
  return {
    name: String(v.name || 'New Icon').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'New Icon',
    keys: String(v.keys || ''), idea: String(v.idea || ''), svg, shapes,
  };
}
// a variant as the review sees it: the 24 Fill, black on white, 192 px PNG (base64)
async function picture(shapes) {
  const K = await import('./iconkit.js');
  const d = K.build(shapes, 24).fill, n = 192;
  const c = document.createElement('canvas'); c.width = n; c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, n, n);
  g.scale(n / 24, n / 24); g.fillStyle = '#000';
  g.fill(new Path2D(d), 'evenodd');
  return c.toDataURL('image/png').split(',')[1];
}

// → { variants: [{ name, keys, idea, svg, shapes, redone, why }], examples: { mine, total }, usage }
// `step(text)` tells the constructor's trace what is happening now
export async function generateIcons(request, n = 3, step = () => {}) {
  const { key, model } = aiPrefs();
  if (!key) throw new Error('Нет ключа API: Настройки › «ИИ для иконок»');
  const rules = (await import('./iconrules.js')).GUIDE_PROMPT;
  const lib = await libraryExamples(request);
  const samples = lib.picked.length ? lib.picked : await builtinExamples();
  // the constant part first and cached: rules, then the style samples that open the list (the same for every request
  // while the library's examples do not change); the request's nearest examples go with the question
  const style = samples.slice(0, 8), nearest = samples.slice(8);
  step(`Запрос к модели · примеров: ${samples.length}${lib.total ? ` из ваших ${lib.total}` : ' (встроенные)'}`);
  const first = await call({
    model, max_tokens: 6000,
    system: [{ type: 'text', text: SYSTEM + '\n\n' + rules + '\n\nTHE LIBRARY\'S STYLE — its own icons (SVG as exported, Fill or Outline):\n' + exText(style), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `${nearest.length ? `More of the library's icons, the nearest to this request:\n${exText(nearest)}\n\n` : ''}Now draw ${n} variants for the request: «${request}»` }],
  });
  let variants = (await Promise.all(parseJson(first.text, 'variants').slice(0, 6).map(toVariant))).filter(Boolean);
  if (!variants.length) throw new Error('модель не прислала ни одного годного варианта');
  // the second pass: the model looks at what came out
  step('Модель смотрит на варианты');
  let redone = 0;
  try {
    const content = [{ type: 'text', text: `Request: «${request}». Drafts follow, numbered from 0.` }];
    for (let i = 0; i < variants.length; i++) {
      content.push({ type: 'text', text: `Draft ${i}: «${variants[i].name}» — ${variants[i].idea}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: await picture(variants[i].shapes) } });
    }
    const second = await call({ model, max_tokens: 4000, system: REVIEW, messages: [{ role: 'user', content }] });
    for (const rv of parseJson(second.text, 'reviews')) {
      const v = variants[rv && rv.i];
      if (!v || rv.ok) { if (v && rv.why) v.why = String(rv.why); continue; }
      const fixed = rv.svg && await toVariant({ ...v, svg: rv.svg });
      if (fixed) { variants[rv.i] = { ...fixed, redone: true, why: String(rv.why || '') }; redone++; } else v.why = String(rv.why || '');
    }
  } catch (e) { /* the review is a bonus: the drafts stay as they are */ }
  return { variants, redone, examples: { mine: lib.picked.length, total: lib.total }, usage: first.usage };
}
