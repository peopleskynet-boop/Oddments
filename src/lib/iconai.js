// Icon generation by request: a language model (Anthropic API, the key the person puts in Settings) gets the
// icon rules, the constructor's primitives and a few worked examples, and answers with constructor documents — shapes
// on the 24 grid, not pictures. Oddments then cleans them up (known types only, the 0.5 px grid, inside the margins),
// runs the rules check and offers the variants; any of them opens in the constructor for finishing by hand.
// Only the request text and the examples leave the computer; the library itself does not.
import { EXAMPLES } from './iconai-examples.js';

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — быстро и недорого' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — лучше качество, дороже' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — самый дешёвый' },
];
const PREFS = 'perch.iconai';
export const aiPrefs = () => { try { return { key: '', model: MODELS[0].id, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch (e) { return { key: '', model: MODELS[0].id }; } };
export const setAiPrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify({ ...aiPrefs(), ...p })); } catch (e) { /* private mode */ } };

const TYPES = ['squircle', 'circle', 'capsule', 'rhombus', 'triangle', 'plus', 'minus', 'check', 'slash', 'dot'];
const MODS = ['plus', 'minus', 'check', 'slash', 'dot'];

const SYSTEM = `You design interface icons for a product design system by assembling primitives in an icon constructor.
You never draw pixels or SVG paths: you answer with constructor documents (JSON).

THE GRID. A 24×24 canvas, origin top-left, y down. Margins 2 px: everything stays inside x,y ∈ [2, 22].
Keylines (the icon's mass should match one of them): square 18×18 at (3,3); vertical rectangle 16×20 at (4,2);
horizontal rectangle 20×16 at (2,4); circle of radius 10 centred at (12,12). All coordinates and sizes are multiples of 0.5.

THE STYLE. Friendly, geometric, solid and simple: a few large shapes, very soft continuous corners (corner radius
4–7 px on big shapes), no tiny details, no text. The library delivers two styles from your one design:
Fill = the silhouette; Outline = the same silhouette with a 2 px inner contour. So design a clear SILHOUETTE.
Details are made by CUTTING shapes out of the silhouette, or by ADDING a shape wholly inside it (an inner detail:
Outline draws it solid inside the frame, Fill knocks it out; keep ≥ 2 px of air between it and the outline's inner edge,
i.e. ≥ 4 px from the silhouette's edge). A detail or a gap is never narrower than 2 px; parts that are
exactly 2 px wide (a handle, a shackle, a line) are fine. Keep 2 px of clearance between separate parts.

THE PRIMITIVES (each: {"type", "x", "y", "w", "h", "op", optional "r", optional "rot"}; x/y/w/h is the bounding box):
- "squircle": rectangle with smoothed corners; "r" = corner radius.
- "circle": circle or ellipse filling the box.
- "capsule": pill (fully rounded ends) — also a 2 px thick line (set w or h to 2).
- "rhombus", "triangle" (apex up; use "rot" degrees to turn it): polygons with soft corners, "r" ≈ 1.5–2.
Shapes are applied in order: "op":"add" unites, "op":"cut" subtracts from everything above it in the list.
MODIFIERS (drawn as 2 px round-capped strokes on top of the finished icon, cutting a 2 px gap around themselves;
always "op":"mod", put them last): "plus", "minus", "check", "slash" (a diagonal from the box's top-left to
bottom-right; for «…off / disabled» use x=3,y=3,w=18,h=18), "dot" (a filled badge circle, e.g. a notification dot).
Badges such as plus/check usually sit in the bottom-right corner (about x=14,y=14,w=7,h=7) or inside a shape.

ANSWER FORMAT. Only JSON, no prose:
{"variants":[{"name":"Name Name","keys":"English, words, Русские, слова","idea":"one short sentence in Russian","shapes":[...]}]}
"name" is in Latin script, Title Case, unique and plain (e.g. "Smart Lamp"); "keys" are search words in English and
Russian. Make the variants genuinely different metaphors or compositions, not small tweaks of one.`;

function examplesText() {
  return EXAMPLES.map((e) => `Request: «${e.prompt}»\n${JSON.stringify({ variants: [{ name: e.name, keys: e.keys, idea: '', shapes: e.shapes }] })}`).join('\n\n');
}

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// → { variants: [{ name, keys, idea, shapes }] }
export async function generateIcons(request, n = 3) {
  const { key, model } = aiPrefs();
  if (!key) throw new Error('Нет ключа API: Настройки › «ИИ для иконок»');
  const body = {
    model,
    max_tokens: 4000,
    // the rules come here, not with the module: iconrules.js pulls in the icon geometry (paper.js), unwanted at start
    system: SYSTEM + '\n\n' + (await import('./iconrules.js')).GUIDE_PROMPT,
    messages: [
      { role: 'user', content: `Worked examples (one variant each):\n\n${examplesText()}\n\nNow make ${n} variants for the request: «${request}»` },
    ],
  };
  // the browser-access opt-in always: the exe's HTTP plugin sends an Origin header too (bug #110)
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  let r;
  if (inApp()) {
    const { fetch: tfetch } = await import('@tauri-apps/plugin-http');
    r = await tfetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  } else {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { ...headers, 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || 'HTTP ' + r.status;
    throw new Error(r.status === 401 ? 'ключ API не подошёл' : r.status === 429 ? 'слишком много запросов, попробуйте через минуту' : msg);
  }
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return { variants: parseVariants(text), usage: j.usage || null };
}

// the model's JSON, read leniently (a fenced block, extra prose) and cleaned up into constructor documents
export function parseVariants(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('модель ответила не в том формате');
  let data;
  try { data = JSON.parse(m[0]); } catch (e) { throw new Error('модель прислала битый JSON'); }
  const list = Array.isArray(data.variants) ? data.variants : [];
  return list.map((v) => ({
    name: String(v.name || 'New Icon').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'New Icon',
    keys: String(v.keys || ''),
    idea: String(v.idea || ''),
    shapes: cleanShapes(v.shapes),
  })).filter((v) => v.shapes.some((s) => s.op === 'add'));
}

const half = (n) => Math.round((+n || 0) * 2) / 2;
function cleanShapes(shapes) {
  if (!Array.isArray(shapes)) return [];
  const out = [];
  for (const s of shapes.slice(0, 24)) {
    if (!s || !TYPES.includes(s.type)) continue;
    let x = half(s.x), y = half(s.y), w = Math.max(MODS.includes(s.type) && s.type !== 'dot' ? 0 : 1, half(s.w)), h = Math.max(MODS.includes(s.type) && s.type !== 'dot' ? 0 : 1, half(s.h));
    // inside the 2 px margins
    x = Math.min(Math.max(x, 2), 22 - Math.min(w, 20)); y = Math.min(Math.max(y, 2), 22 - Math.min(h, 20));
    w = Math.min(w, 22 - x); h = Math.min(h, 22 - y);
    const op = MODS.includes(s.type) ? 'mod' : s.op === 'cut' ? 'cut' : 'add';
    const c = { id: Math.random().toString(36).slice(2, 9), type: s.type, x, y, w, h, op, rot: Math.round(+s.rot || 0) };
    if (s.r != null) c.r = Math.max(0, half(s.r));
    out.push(c);
  }
  // modifiers go last, as the constructor draws them over the finished icon
  return [...out.filter((s) => s.op !== 'mod'), ...out.filter((s) => s.op === 'mod')];
}
