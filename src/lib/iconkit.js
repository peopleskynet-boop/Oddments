// Icon constructor — the geometry. Icons are built the way large product icon libraries build them: filled shapes with soft continuous corners, assembled from
// primitives by adding and cutting; «Fill» is the silhouette, «Outline» the same silhouette with the inside cut out
// at the line thickness of the size. Shapes are authored once on the 24 px grid and mapped to every size through
// the keylines. paper.js (MIT) does the boolean work, offset.js (Clipper2) the exact inset, figma-squircle (MIT) the
// Figma-style smoothed corners.
import paper from 'paper';
import { offsetShape, strokeShape, smallFix } from './offset.js';
import { getSvgPath } from 'figma-squircle';
import { DEC } from '../util.js';

// size → margin, keyline square [from, to], outline thickness: a common icon grid (the keyline square is ¾ of the size)
export const SIZES = {
  16: { margin: 1, key: [2, 14], t: 1.5 },
  20: { margin: 2, key: [2.5, 17.5], t: 1.5 },
  24: { margin: 2, key: [3, 21], t: 2 },
  32: { margin: 3, key: [4, 28], t: 2.5 },
  48: { margin: 4, key: [6, 42], t: 3 },
};
export const BASE = 24;
export const COLOR = '#1A1A1A';
export const SMOOTH = 0.6; // corner smoothing of the library's shapes (Figma «iOS» smoothing)

// keylines of the 24 grid (the templates' primitives): square 18, vertical 16×20, horizontal 20×16, circle, rhombus
export const KEYLINES = {
  square: { x: 3, y: 3, w: 18, h: 18 },
  vertical: { x: 4, y: 2, w: 16, h: 20 },
  horizontal: { x: 2, y: 4, w: 20, h: 16 },
  circle: { cx: 12, cy: 12, r: 10 },
};

let ready = false;
function setup() {
  if (ready) return;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  paper.setup(c);
  ready = true;
}

// primitives in 24-grid units; every shape: { id, type, x, y, w, h, r (corner radius), rot (deg), op: 'add'|'cut', d? }
export const TYPES = {
  squircle: 'Скруглённый прямоугольник',
  circle: 'Круг / овал',
  capsule: 'Капсула',
  rhombus: 'Ромб',
  triangle: 'Треугольник',
  path: 'Контур',
  plus: 'Плюс',
  minus: 'Минус',
  check: 'Галочка',
  slash: 'Перечёркнуто',
  dot: 'Точка',
};
// modifiers: drawn as lines of the size's own thickness (round caps) over the finished Fill / Outline, cutting the icon
// around them by one line — the way the library's «… Off» (a slash with a gap) and «… Add» icons are made
export const MODS = new Set(['plus', 'minus', 'check', 'slash', 'dot']);

// a polygon with soft corners: shrink by r, grow back by r with round joins
function roundPoly(points, r) {
  if (!r) return new paper.Path({ segments: points, closed: true, insert: false });
  // each corner: a circular arc of radius r tangent to both sides — two points with exact handles, so the shape is
  // light to edit point by point (an offset round trip gave ~30 points)
  const P = points.map((q) => new paper.Point(q)), n = P.length, segs = [];
  for (let i = 0; i < n; i++) {
    const v = P[i], a = P[(i - 1 + n) % n].subtract(v).normalize(), b = P[(i + 1) % n].subtract(v).normalize();
    const half = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) / 2; // half of the inner angle
    const turn = Math.PI - 2 * half;
    const d = Math.min(r / Math.tan(half), P[(i - 1 + n) % n].getDistance(v) / 2, P[(i + 1) % n].getDistance(v) / 2);
    const rr = d * Math.tan(half), k = (4 / 3) * Math.tan(turn / 4) * rr;
    const pin = v.add(a.multiply(d)), pout = v.add(b.multiply(d));
    segs.push(new paper.Segment(pin, a.multiply(0), a.multiply(-k)));
    segs.push(new paper.Segment(pout, b.multiply(-k), b.multiply(0)));
  }
  return new paper.Path({ segments: segs, closed: true, insert: false });
}

function shapePath(s) {
  let p;
  const { x, y, w, h } = s;
  if (s.type === 'squircle') {
    const r = Math.max(0, Math.min(s.r ?? 4, w / 2, h / 2));
    p = new paper.CompoundPath({ pathData: getSvgPath({ width: w, height: h, cornerRadius: r, cornerSmoothing: SMOOTH }), insert: false });
    p.translate(new paper.Point(x, y));
  } else if (s.type === 'circle') {
    p = new paper.Path.Ellipse({ rectangle: new paper.Rectangle(x, y, w, h), insert: false });
  } else if (s.type === 'capsule') {
    const r = Math.min(w, h) / 2;
    p = new paper.CompoundPath({ pathData: getSvgPath({ width: w, height: h, cornerRadius: r, cornerSmoothing: 0 }), insert: false });
    p.translate(new paper.Point(x, y));
  } else if (s.type === 'rhombus') {
    p = roundPoly([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], Math.min(s.r ?? 1.5, Math.min(w, h) / 4));
  } else if (s.type === 'triangle') {
    p = roundPoly([[x + w / 2, y], [x + w, y + h], [x, y + h]], Math.min(s.r ?? 1.5, Math.min(w, h) / 4));
  } else if (s.type === 'path' && s.d) {
    // a shape taken from an SVG: its own path data, normalised to its box on import (sx/sy keep the aspect)
    p = new paper.CompoundPath({ pathData: s.d, insert: false });
    p.fillRule = 'evenodd';
    const b = p.bounds;
    if (b.width && b.height) {
      p.scale(w / b.width, h / b.height, b.topLeft);
      p.translate(new paper.Point(x - b.x, y - b.y));
    }
  } else {
    p = new paper.Path.Rectangle({ rectangle: new paper.Rectangle(x, y, w, h), insert: false });
  }
  flipRot(p, s, new paper.Point(x + w / 2, y + h / 2));
  return p;
}
// mirrored (Shift+H / Shift+V, as in Figma) and turned, about the shape's centre
function flipRot(p, s, c) {
  if (s.fx || s.fy) p.scale(s.fx ? -1 : 1, s.fy ? -1 : 1, c);
  if (s.rot) p.rotate(s.rot, c);
}

// The silhouette and the inner details on the 24 grid, shapes in order, each added or cut. An added shape lying
// wholly inside what is already there is a DETAIL (a stripe in a card, a capsule inside a frame): in the silhouette it
// would vanish — Outline cuts the whole inside away, Fill paints over it — so it is kept apart: Outline draws it solid
// inside the frame, Fill knocks it out of the silhouette.
const insideOf = (p, acc) => {
  const a = Math.abs(p.area);
  return a > 1e-6 && Math.abs(p.intersect(acc, { insert: false }).area) >= a * 0.995;
};
export function parts(shapes) {
  setup();
  let acc = null, det = null;
  for (const s of shapes) {
    if (s.hidden || MODS.has(s.type)) continue;
    const p = shapePath(s);
    if (s.op === 'cut') {
      if (acc) acc = acc.subtract(p, { insert: false });
      if (det) det = det.subtract(p, { insert: false });
    } else if (acc && insideOf(p, acc)) det = det ? det.unite(p, { insert: false }) : p;
    else acc = acc ? acc.unite(p, { insert: false }) : p;
  }
  if (det && Math.abs(det.area) < 1e-4) det = null;
  return { acc, det };
}
export const silhouette = (shapes) => parts(shapes).acc;

// a modifier at one size: its box mapped from the 24 grid, drawn with that size's line; `extra` widens it on every
// side (the gap cut around it is the same lines, one line wider each way — an exact capsule, not an offset of one)
function modPath(s, S, map, extra = 0) {
  const a = map(s.x, s.y), b = map(s.x + s.w, s.y + s.h);
  const x = a.x, y = a.y, w = b.x - a.x, h = b.y - a.y, cx = x + w / 2, cy = y + h / 2;
  if (s.type === 'dot') return new paper.Path.Ellipse({ rectangle: new paper.Rectangle(x - extra, y - extra, w + 2 * extra, h + 2 * extra), insert: false });
  const lines = s.type === 'plus' ? [[[x, cy], [x + w, cy]], [[cx, y], [cx, y + h]]]
    : s.type === 'minus' ? [[[x, cy], [x + w, cy]]]
      : s.type === 'check' ? [[[x, y + h * 0.55], [x + w * 0.38, y + h * 0.9], [x + w, y + h * 0.12]]]
        : [[[x, y], [x + w, y + h]]]; // slash
  let acc = null;
  for (const pts of lines) {
    // a line with no length (a modifier being drawn, still a point): a round dot
    if (pts.every((p) => Math.abs(p[0] - pts[0][0]) < 1e-6 && Math.abs(p[1] - pts[0][1]) < 1e-6)) {
      const dot = new paper.Path.Circle({ center: pts[0], radius: S.t / 2 + extra, insert: false });
      acc = acc ? acc.unite(dot, { insert: false }) : dot;
      continue;
    }
    const line = new paper.Path({ segments: pts, closed: false, insert: false });
    const g = strokeShape(line, S.t + 2 * extra);
    acc = acc ? acc.unite(g, { insert: false }) : g;
  }
  flipRot(acc, s, new paper.Point(cx, cy));
  return acc;
}

// «Умный 16»: a plain 24 → 16 scale leaves 2 px details at 1.33 px against a 1.5 px line, gaps that close up and edges
// between pixels. What a designer does by hand, done to the scaled silhouette: (1) its box lands on whole pixels
// (shifted and stretched by at most half a pixel), (2) gaps narrower than a line are opened up, (3) parts thinner than
// a line are thickened. Returns the new silhouette, the snap (for details and modifiers) and what was done.
const SMART_STEP = 0.3;
function smartSmall(fill, t) {
  const done = [];
  const b = fill.bounds;
  const m = SIZES[16].margin;
  const x0 = Math.max(m, Math.round(b.x)), y0 = Math.max(m, Math.round(b.y));
  const w1 = Math.max(1, Math.min(16 - m - x0, Math.round(b.right) - x0)), h1 = Math.max(1, Math.min(16 - m - y0, Math.round(b.bottom) - y0));
  const sx = w1 / b.width, sy = h1 / b.height;
  const snap = (p) => {
    const c = p.clone({ insert: false });
    c.scale(sx, sy, new paper.Point(b.x, b.y));
    c.translate(new paper.Point(x0 - b.x, y0 - b.y));
    return c;
  };
  const moved = Math.abs(x0 - b.x) + Math.abs(y0 - b.y) + Math.abs(w1 - b.width) + Math.abs(h1 - b.height);
  let f = snap(fill);
  if (moved > 0.05) done.push('на пиксельной сетке');
  const r = smallFix(f, t, SMART_STEP, SIZES[16].margin, 16);
  if (r.item) f = r.item;
  if (r.thick) done.push('тонкие детали толще');
  if (r.wider) done.push('просветы шире');
  return { fill: f, snap, done };
}

// one size: the silhouette mapped through the keylines (24 → size), Fill and Outline as path data, modifiers on top.
// At 16 px the silhouette is fitted by hand rules first (smartSmall); { smart: false } gives the plain scale.
// the panel asks for every size twice (Outline and Fill rows) and the check once more: the same document is built once
const built = new Map();
export function build(shapes, size, { smart = size === 16 } = {}) {
  const key = size + (smart ? 's' : 'p') + JSON.stringify(shapes);
  if (built.has(key)) return built.get(key);
  const r = buildNow(shapes, size, smart);
  built.set(key, r);
  if (built.size > 40) built.delete(built.keys().next().value);
  return r;
}
function buildNow(shapes, size, smart) {
  setup();
  const { acc: base, det } = parts(shapes);
  if (!base || !base.area) return { fill: '', outline: '', bounds: null, size };
  const S = SIZES[size], B = SIZES[BASE], k = (S.key[1] - S.key[0]) / (B.key[1] - B.key[0]);
  let toSize = (it) => {
    const c = it.clone({ insert: false });
    c.scale(k, new paper.Point(B.key[0], B.key[0]));
    c.translate(new paper.Point(S.key[0] - B.key[0], S.key[0] - B.key[0]));
    return c;
  };
  let map = (px, py) => new paper.Point(S.key[0] + (px - B.key[0]) * k, S.key[0] + (py - B.key[0]) * k);
  let fill = toSize(base), smartDone = [];
  if (smart) {
    const r = smartSmall(fill, S.t);
    fill = r.fill; smartDone = r.done;
    const plain = toSize, plainMap = map, snap = r.snap;
    toSize = (it) => snap(plain(it));
    map = (px, py) => { const q = new paper.Path({ segments: [plainMap(px, py)], insert: false }); return snap(q).firstSegment.point; };
  }
  const silFill = fill, detail = det ? toSize(det) : null;
  const inner = offsetShape(fill, -S.t);
  let outline = inner && Math.abs(inner.area) > 0.01 ? fill.subtract(inner, { insert: false }) : fill;
  if (detail) {
    outline = outline.unite(detail, { insert: false });
    fill = fill.subtract(detail, { insert: false });
  }
  for (const s of shapes) {
    if (s.hidden || !MODS.has(s.type)) continue;
    const g = modPath(s, S, map);
    const gap = modPath(s, S, map, S.t);
    fill = fill.subtract(gap, { insert: false }).unite(g, { insert: false });
    outline = outline.subtract(gap, { insert: false }).unite(g, { insert: false });
  }
  const round = (d) => d.replace(/-?\d+\.\d{3,}/g, (n) => String(+(+n).toFixed(3)));
  return { fill: round(fill.pathData), outline: round(outline.pathData), bounds: silFill.bounds, size, fillPath: silFill, innerPath: inner, detailPath: detail, smart: smartDone };
}

export function svgOf(pathData, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none"><path d="${pathData}" fill="${COLOR}" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

/* ---------- editing points (Enter on a shape, as in Figma) ---------- */
// A shape as editable contours on the 24 grid: [[{ p: [x, y], i: [dx, dy], o: [dx, dy] }, …], …], each closed;
// i / o — the handles, relative to the point (0, 0 = a sharp corner).
export function contoursOf(s) {
  setup();
  const p = shapePath(s);
  const kids = p.className === 'CompoundPath' ? p.children : [p];
  return kids.map((c) => merged(c.segments.map((g) => ({ p: [g.point.x, g.point.y], i: [g.handleIn.x, g.handleIn.y], o: [g.handleOut.x, g.handleOut.y] }))));
}
// Shapes are built from pieces (a smoothed corner + a straight edge in figma-squircle): where two pieces meet, two
// points lie in one place. One point there, with the first one's incoming handle and the second one's outgoing.
function merged(c) {
  const out = [];
  for (const q of c) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.p[0] - q.p[0], last.p[1] - q.p[1]) < 1e-4) last.o = q.o;
    else out.push({ p: q.p.slice(), i: q.i.slice(), o: q.o.slice() });
  }
  if (out.length > 1) {
    const a = out[out.length - 1], b = out[0];
    if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < 1e-4) { b.i = a.i; out.pop(); }
  }
  return out;
}
function pathOfContours(cs) {
  const kids = cs.filter((c) => c.length > 1).map((c) => new paper.Path({
    segments: c.map((q) => new paper.Segment(new paper.Point(q.p), new paper.Point(q.i), new paper.Point(q.o))), closed: true, insert: false,
  }));
  return new paper.CompoundPath({ children: kids, insert: false });
}
// contours → a «Контур» shape (type path) whose box is exactly its bounds, so its own scale stays 1
export function pathShape(base, cs) {
  setup();
  const cp = pathOfContours(cs), b = cp.bounds;
  const out = { ...base, type: 'path', d: cp.pathData, x: b.x, y: b.y, w: b.width, h: b.height, rot: 0, fx: false, fy: false };
  delete out.r;
  return out;
}
// a point on the outline near (x, y) (within tol) is added there, the curve keeps its shape; null when too far
export function insertPoint(cs, x, y, tol) {
  setup();
  const at = new paper.Point(x, y);
  let best = null;
  cs.forEach((c, ci) => {
    if (c.length < 2) return;
    const path = pathOfContours([c]).children[0];
    const loc = path.getNearestLocation(at);
    if (loc && loc.distance <= tol && (!best || loc.distance < best.loc.distance)) best = { ci, loc, path };
  });
  if (!best) return null;
  best.loc.curve.divideAtTime(best.loc.time);
  const segs = best.path.segments.map((g) => ({ p: [g.point.x, g.point.y], i: [g.handleIn.x, g.handleIn.y], o: [g.handleOut.x, g.handleOut.y] }));
  const out = cs.map((c, i) => (i === best.ci ? segs : c));
  // the new point is the one at the nearest location
  const si = segs.findIndex((g) => Math.hypot(g.p[0] - best.loc.point.x, g.p[1] - best.loc.point.y) < 1e-6);
  return { cs: out, ci: best.ci, si };
}
// a sharp corner rounded with radius r (Figma's per-point corner radius, baked into the contour): the point becomes two,
// where a circle of radius r touches both sides, joined by an arc. The sides' directions come from the neighbouring
// points or, on a curve, from its handle. r is cut down if the sides are too short. → the new contour
export function roundPoint(c, si, r) {
  const n = c.length, q = c[si];
  if (n < 3 || r <= 0) return c;
  const prev = c[(si - 1 + n) % n], next = c[(si + 1) % n];
  // the side's direction: this point's own handle, else the neighbour's handle facing it, else the neighbour itself
  const toward = (other, mine, theirs) => {
    const t = Math.hypot(...mine) > 1e-6 ? [q.p[0] + mine[0], q.p[1] + mine[1]]
      : Math.hypot(...theirs) > 1e-6 ? [other.p[0] + theirs[0], other.p[1] + theirs[1]] : other.p;
    const dx = t[0] - q.p[0], dy = t[1] - q.p[1], l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l, len: Math.hypot(other.p[0] - q.p[0], other.p[1] - q.p[1]) };
  };
  const a = toward(prev, q.i, prev.o), b = toward(next, q.o, next.i);
  const cos = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  const half = Math.acos(cos) / 2;
  if (half < 0.01 || half > Math.PI / 2 - 0.01) return c; // a straight line or a needle: nothing to round
  const d = Math.min(r / Math.tan(half), a.len * 0.5, b.len * 0.5);
  const rr = d * Math.tan(half), k = (4 / 3) * Math.tan((Math.PI - 2 * half) / 4) * rr;
  const pin = { p: [q.p[0] + a.x * d, q.p[1] + a.y * d], i: [0, 0], o: [-a.x * k, -a.y * k] };
  const pout = { p: [q.p[0] + b.x * d, q.p[1] + b.y * d], i: [-b.x * k, -b.y * k], o: [0, 0] };
  return [...c.slice(0, si), pin, pout, ...c.slice(si + 1)];
}

// double-click on a point: a sharp corner becomes smooth (handles along its neighbours), a smooth one sharp
export function toggleSmooth(c, si) {
  const q = c[si], n = c.length;
  if (Math.hypot(...q.i) + Math.hypot(...q.o) > 1e-6) { q.i = [0, 0]; q.o = [0, 0]; return; }
  const a = c[(si - 1 + n) % n].p, b = c[(si + 1) % n].p;
  const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
  const la = Math.hypot(q.p[0] - a[0], q.p[1] - a[1]) / 3, lb = Math.hypot(b[0] - q.p[0], b[1] - q.p[1]) / 3;
  q.i = [(-tx / tl) * la, (-ty / tl) * la];
  q.o = [(tx / tl) * lb, (ty / tl) * lb];
}

// what an SVG file holds, as one path in its own coordinates (for «Контур из SVG» and opening library icons)
export function pathFromSvg(text) {
  setup();
  const item = paper.project.importSVG(text, { insert: false, expandShapes: true });
  let acc = null;
  item.getItems({ class: paper.Path }).concat(item.getItems({ class: paper.CompoundPath })).forEach((p) => {
    if (p.parent && p.parent.className === 'CompoundPath') return;
    const c = p.clone({ insert: false });
    acc = acc ? acc.unite(c, { insert: false }) : c;
  });
  item.remove();
  return acc ? acc.pathData : '';
}

/* ---------- the stylizer: any icon → the library's style ---------- */
// Any SVG icon (Material, Lucide, a stock set, a Figma export) becomes a constructor document in the constructor's style:
// - filled shapes, and the closed contours of a line icon taken as filled areas (with the outer half of their line),
//   make the silhouette — the library's icons are silhouettes, «Outline» is cut from them;
// - open lines (a door, an arrow, a check) become lines of the size's own thickness with round caps — inside the
//   silhouette they are inner details (solid in Outline, cut out of Fill);
// - the whole is fitted into the keyline shape that suits its proportions (square 18, vertical 16×20, horizontal
//   20×16), centred, its box on the 0.5 px grid;
// - corners get softened: convex ones by `soft` px, concave ones by a little less (an opening, then a closing).
// → { shapes, note }
export function stylize(svgText, { soft = 1 } = {}) {
  setup();
  const item = paper.project.importSVG(svgText, { insert: false, expandShapes: true });
  const fills = [], lines = [];
  let strokeW = 0;
  const all = item.getItems({ class: paper.Path }).concat(item.getItems({ class: paper.CompoundPath }));
  for (const p of all) {
    if (p.parent && p.parent.className === 'CompoundPath') continue;
    const filled = p.fillColor && p.fillColor.alpha > 0.05;
    const stroked = p.strokeColor && p.strokeColor.alpha > 0.05 && p.strokeWidth > 0;
    if (stroked) strokeW = Math.max(strokeW, p.strokeWidth * (p.globalMatrix ? Math.abs(p.globalMatrix.scaling.x) : 1));
    const parts = p.className === 'CompoundPath' ? p.children : [p];
    for (const q of parts) {
      const c = q.clone({ insert: false });
      if (p.globalMatrix) c.transform(p.globalMatrix);
      // a contour that ends where it starts is closed even without «z» (Lucide's bell)
      const shut = q.closed || (q.segments.length > 2 && q.firstSegment.point.getDistance(q.lastSegment.point) < Math.max(0.05, (p.strokeWidth || 0) * 0.25));
      if (shut && !c.closed) c.closed = true;
      if (filled || (stroked && shut)) fills.push({ path: c, grow: stroked && !filled ? 0.5 : 0 });
      else if (stroked && !shut && q.length > 0.01) lines.push(c);
    }
  }
  item.remove();
  if (!fills.length && !lines.length) return { shapes: [], note: 'В SVG нет фигур' };
  // the whole drawing's box (lines with their stroke) → the keyline box that suits it
  let box = null;
  for (const f of fills) box = box ? box.unite(f.path.bounds) : f.path.bounds.clone();
  for (const l of lines) box = box ? box.unite(l.bounds) : l.bounds.clone();
  box = box.expand(strokeW);
  const ar = box.width / Math.max(box.height, 1e-6);
  const key = ar > 1.15 ? { x: 2, y: 4, w: 20, h: 16 } : ar < 0.87 ? { x: 4, y: 2, w: 16, h: 20 } : { x: 3, y: 3, w: 18, h: 18 };
  const k = Math.min(key.w / box.width, key.h / box.height);
  const m = new paper.Matrix().translate(key.x + key.w / 2, key.y + key.h / 2).scale(k).translate(-box.center.x, -box.center.y);
  const t = SIZES[BASE].t;
  // silhouette: each area (a line icon's closed contour grows by half its line, so the outer edge stays where it was)
  let sil = null;
  for (const f of fills) {
    let p = f.path.clone({ insert: false });
    p.transform(m);
    if (f.grow && strokeW) { const g = offsetShape(p, (strokeW * k) / 2); if (g) p = g; }
    p.fillRule = 'nonzero';
    sil = sil ? sil.unite(p, { insert: false }) : p;
  }
  if (sil && soft > 0) {
    const a = offsetShape(sil, -soft), b = a && offsetShape(a, soft); // convex corners round, hair-thin bits go
    if (b && Math.abs(b.area) > Math.abs(sil.area) * 0.6) sil = b;
    const c = offsetShape(sil, soft * 0.6), d = c && offsetShape(c, -soft * 0.6); // concave corners soften
    if (d) sil = d;
  }
  const shapes = [];
  const asShape = (p) => { const b = p.bounds; return { id: Math.random().toString(36).slice(2, 9), type: 'path', d: p.pathData, x: b.x, y: b.y, w: b.width, h: b.height, op: 'add', rot: 0 }; };
  if (sil && Math.abs(sil.area) > 0.5) shapes.push(asShape(sil));
  // lines: the library's line (2 px on 24), round caps and joins
  for (const l of lines) {
    const c = l.clone({ insert: false });
    c.transform(m);
    const g = strokeShape(c, t);
    if (g && Math.abs(g.area) > 0.05) shapes.push(asShape(g));
  }
  const note = `${fills.length ? 'Силуэт' : 'Без силуэта'}${lines.length ? ` и ${lines.length} ${lines.length === 1 ? 'линия' : lines.length < 5 ? 'линии' : 'линий'}` : ''} — вписано в ${key.w === key.h ? 'квадрат 18' : key.w > key.h ? 'прямоугольник 20×16' : 'прямоугольник 16×20'}`;
  return { shapes, note };
}

// «Привести к правилам»: what can be fixed by moving and scaling — every box on the 0.5 px grid, the icon inside the
// margins (scaled down about the centre if it sticks out), the optical centre (the ink's centre of mass) moved to the
// middle when it is more than half a pixel off. Thin parts and narrow gaps are the drawing itself: they stay in the check.
// → { shapes, done: [texts] }
export function fixToRules(shapes) {
  setup();
  const out = shapes.map((s) => ({ ...s }));
  const done = [];
  const snap = (v) => Math.round(v * 2) / 2;
  const S = SIZES[BASE];
  let r = build(out, BASE);
  if (r.bounds) {
    const b = r.bounds, lo = S.margin, hi = BASE - S.margin;
    if (b.x < lo - 0.01 || b.y < lo - 0.01 || b.right > hi + 0.01 || b.bottom > hi + 0.01) {
      const k = Math.min(1, (hi - lo) / Math.max(b.width, b.height));
      const cx = b.center.x, cy = b.center.y;
      for (const s of out) { s.x = 12 + (s.x - cx) * k; s.y = 12 + (s.y - cy) * k; s.w *= k; s.h *= k; }
      done.push(k < 1 ? `уменьшено до полей (${Math.round(k * 100)} %)` : 'сдвинуто внутрь полей');
    }
  }
  // the centre of the ink: area-weighted over a 0.25 px raster of the silhouette
  r = build(out, BASE);
  if (r.fillPath) {
    let sx = 0, sy = 0, n = 0;
    for (let y = 0.125; y < 24; y += 0.25) for (let x = 0.125; x < 24; x += 0.25) if (r.fillPath.contains(new paper.Point(x, y))) { sx += x; sy += y; n++; }
    if (n) {
      const dx = 12 - sx / n, dy = 12 - sy / n;
      if (Math.hypot(dx, dy) > 0.5) {
        // never back out of the margins
        const b = r.bounds, lo = S.margin, hi = BASE - S.margin;
        const mx = snap(Math.max(lo - b.x, Math.min(hi - b.right, dx))), my = snap(Math.max(lo - b.y, Math.min(hi - b.bottom, dy)));
        for (const s of out) { s.x += mx; s.y += my; }
        done.push(`центр тяжести на месте (сдвиг ${String(mx).replace('.', DEC)}; ${String(my).replace('.', DEC)})`);
      }
    }
  }
  let moved = 0;
  for (const s of out) {
    const nx = snap(s.x), ny = snap(s.y), nw = Math.max(0.5, snap(s.w)), nh = MODS.has(s.type) ? snap(s.h) : Math.max(0.5, snap(s.h));
    if (nx !== s.x || ny !== s.y || nw !== s.w || nh !== s.h) moved++;
    s.x = nx; s.y = ny; s.w = nw; s.h = nh;
  }
  if (moved) done.push(`на пиксельную сетку: ${moved}`);
  return { shapes: out, done };
}

/* ---------- the rules check ---------- */
// Each check: { ok, text }. The same rules a design-system review would apply first.
export function check(shapes, size = BASE, opts) {
  setup();
  const out = [];
  const S = SIZES[size];
  const r = build(shapes, size, opts);
  if (!r.bounds) return [{ ok: false, text: 'Пусто: добавьте фигуру' }];
  const b = r.bounds, lo = S.margin - 0.01, hi = size - S.margin + 0.01;
  const inside = b.x >= lo && b.y >= lo && b.right <= hi && b.bottom <= hi;
  const box = new paper.Path.Rectangle({ rectangle: new paper.Rectangle(S.margin, S.margin, size - 2 * S.margin, size - 2 * S.margin), insert: false });
  out.push({ ok: inside, text: `Внутри полей ${S.margin} px`,
    how: `Иконка выходит за поле ${S.margin} px у края — уменьшите её или сдвиньте внутрь.`, fix: 'rules',
    area: inside ? '' : r.fillPath.subtract(box, { insert: false }).pathData });
  // parts thinner than the line: shrink by just under half a line and grow back (morphological opening) — what does
  // not come back is thinner than a line and would break up at this size (a part exactly one line thick, like a lock's
  // shackle, is the library's normal). Corners always lose a little area: hence the margin.
  const t = S.t, fill = r.fillPath, A = Math.abs(fill.area);
  const opened = grow(grow(fill, -t * 0.45), t * 0.45);
  const thinLost = A - (opened ? Math.abs(opened.area) : 0);
  const thinOk = thinLost < t * t * 0.6;
  out.push({ ok: thinOk, text: `Детали не тоньше линии (${fmt(t)} px)`,
    how: `Красным — места тоньше ${fmt(t)} px: на этом размере они рассыплются. Сделайте их толще или уберите.`,
    area: thinOk || !opened ? '' : fill.subtract(opened, { insert: false }).pathData });
  // gaps narrower than a line: grow by just under half a line and shrink back (closing) — what newly appears was a
  // narrow gap (a gap exactly one line wide, like a calendar's divider, is fine)
  const closed = grow(grow(fill, t * 0.45), -t * 0.45);
  const gapFilled = (closed ? Math.abs(closed.area) : A) - A;
  const gapOk = gapFilled < t * t * 0.6;
  out.push({ ok: gapOk, text: `Просветы не уже линии (${fmt(t)} px)`,
    how: `Красным — щели уже ${fmt(t)} px: на экране они слипнутся. Раздвиньте фигуры или сделайте вырез шире.`,
    area: gapOk || !closed ? '' : closed.subtract(fill, { insert: false }).pathData });
  // an inner detail keeps a line of air from the outline's inner edge (and, in Fill, its knock-out from the edge)
  if (r.detailPath) {
    const room = grow(fill, -2 * t + 0.05);
    const out2 = room ? Math.abs(r.detailPath.subtract(room, { insert: false }).area) : Math.abs(r.detailPath.area);
    const detOk = out2 < t * t * 0.3;
    out.push({ ok: detOk, text: detOk ? 'Внутренняя деталь в стороне от обводки' : 'Внутренняя деталь слишком близко к краю',
      how: `Между деталью внутри и краем иконки нужен зазор не меньше ${fmt(2 * t)} px (линия обводки + линия воздуха). Красным — что заходит ближе: уменьшите деталь или отодвиньте её к центру.`,
      area: detOk ? '' : (room ? r.detailPath.subtract(room, { insert: false }) : r.detailPath).pathData });
  }
  // shapes placed on the pixel grid (whole or half pixels) at the base size; rounded results may sit between
  if (size === BASE) {
    const onGrid = (v) => Math.abs((v || 0) * 2 - Math.round((v || 0) * 2)) < 0.02;
    out.push({ ok: shapes.every((s) => [s.x, s.y, s.w, s.h].every(onGrid)), text: 'Фигуры на пиксельной сетке (шаг 0,5 px)',
      how: 'Края фигур между пикселями — на экране они расплывутся. «Исправить» поставит всё на сетку 0,5 px.', fix: 'rules' });
  }
  return out;
}
const grow = (p, d) => (p ? offsetShape(p, d) : null);
const fmt = (n) => String(+n.toFixed(2)).replace('.', DEC);
