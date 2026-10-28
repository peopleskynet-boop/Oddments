// SVG → 3D: icons and logos from SVG become clean extruded models for Blender. The mesh is built clean from
// the start (no general remesher needed for the «Точная» mode): the outline is marked out evenly (denser on
// curves, sharp corners kept), walls and the rounded bevel are rings of quads, and the flat caps get edge
// loops plus a grid in the middle, with 2→1 transitions, bands for rings and bridges for one hole; a cap that
// would come out with thin slivers stays a clean n-gon.
// Loaded lazily, only when the converter opens.
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

/* ---------- contours: SVG → shapes → evenly marked, oriented loops ---------- */
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return a / 2; };
function clean(pts) {
  const out = [];
  for (const p of pts) if (!out.length || out[out.length - 1].distanceTo(p) > 1e-6) out.push(p.clone());
  while (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 1e-6) out.pop();
  return out;
}
// Even marking along the outline: denser on curves (turn limit), corners kept exactly where they are.
function resample(dense, step, cornerDeg) {
  const n = dense.length, cosC = Math.cos(cornerDeg * Math.PI / 180);
  const dir = (i) => dense[(i + 1) % n].clone().sub(dense[i]).normalize();
  const corners = [];
  for (let i = 0; i < n; i++) if (dir((i - 1 + n) % n).dot(dir(i)) < cosC) corners.push(i);
  const starts = corners.length ? corners : [0];
  const out = [];
  const MAX_TURN = 10 * Math.PI / 180;
  for (let s = 0; s < starts.length; s++) {
    const a = starts[s], b = corners.length ? starts[(s + 1) % starts.length] : a;
    const run = [dense[a]];
    let i = a;
    do { i = (i + 1) % n; run.push(dense[i]); } while (i !== b);
    let len = 0, turn = 0;
    const cum = [0];
    for (let k = 1; k < run.length; k++) {
      len += run[k].distanceTo(run[k - 1]); cum.push(len);
      if (k > 1) { const d1 = run[k - 1].clone().sub(run[k - 2]).normalize(), d2 = run[k].clone().sub(run[k - 1]).normalize(); turn += Math.acos(Math.max(-1, Math.min(1, d1.dot(d2)))); }
    }
    let seg = Math.max(1, Math.ceil(len / step), Math.ceil(turn / MAX_TURN));
    // an even count between sharp corners keeps every corner on an even index: a quad cap can then use the
    // corners as its own vertices (the odd points become edge middles)
    if (corners.length) seg = Math.ceil(seg / 4) * 4; // multiples of 4: corners survive the 2→1 transitions too
    let k = 0;
    for (let t = 0; t < seg; t++) {
      const at = (t / seg) * len;
      while (k < cum.length - 2 && cum[k + 1] < at) k++;
      const f = (at - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
      out.push(run[k].clone().lerp(run[k + 1], f));
    }
  }
  out.corners = corners.length;
  return out;
}

// exactly n points, evenly by length (for a ring's hole: the same count as its outline)
function resampleN(dense, n) {
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) cum.push(cum[i - 1] + dense[i % dense.length].distanceTo(dense[i - 1]));
  const len = cum[cum.length - 1], out = [];
  let k = 0;
  for (let t = 0; t < n; t++) {
    const at = (t / n) * len;
    while (k < cum.length - 2 && cum[k + 1] < at) k++;
    const f = (at - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
    out.push(dense[k].clone().lerp(dense[(k + 1) % dense.length], f));
  }
  out.corners = 0;
  return out;
}

function parseSvg(text) {
  const data = new SVGLoader().parse(text);
  const shapes = [];
  let strokesOnly = true;
  for (const p of data.paths) {
    const st = p.userData.style || {};
    if (st.fill === 'none' || st.fill === 'transparent') continue;
    strokesOnly = false;
    shapes.push(...SVGLoader.createShapes(p));
  }
  // the drawing's frame (viewBox, else width × height): a set of icons scaled by it keeps one size and one depth
  let view = null;
  const x = data.xml && data.xml.getAttribute ? data.xml : null;
  const vb = x && (x.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) view = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  else if (x && parseFloat(x.getAttribute('width')) > 0 && parseFloat(x.getAttribute('height')) > 0) view = { x: 0, y: 0, w: parseFloat(x.getAttribute('width')), h: parseFloat(x.getAttribute('height')) };
  return { shapes, view, strokesOnly: strokesOnly && data.paths.length > 0 };
}

// reverse the direction but keep point 0 first: corners stay on even indices
const flip = (pts) => [pts[0], ...pts.slice(1).reverse()];

// a point count divisible by 4 (quad caps and their 2→1 transitions need it): split the longest edges
function mult4(pts) {
  while (pts.length % 4) {
    let k = 0, best = -1;
    pts.forEach((p, i) => { const d = p.distanceToSquared(pts[(i + 1) % pts.length]); if (d > best) { best = d; k = i; } });
    pts.splice(k + 1, 0, pts[k].clone().lerp(pts[(k + 1) % pts.length], 0.5));
  }
  return pts;
}

// shapes → [{ outer: [V2], holes: [[V2]] }] in a 2-unit box, y up, outer CCW and holes CW
// Rounded corners: every sharp corner of the outline (outer tips and inner notches alike) is replaced by a
// smooth bend. Distances are measured along the outline itself, so corners between curves (the tip and the
// notch of a heart) round just like corners between straight sides. The bend reaches t = r / tan(angle / 2)
// along each side — shorter when the next corner is close, so neighbouring bends never overlap.
function filletCorners(pts, radius, cornerDeg) {
  if (!radius || pts.length < 3) return pts;
  const n = pts.length, cosC = Math.cos(cornerDeg * Math.PI / 180);
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + pts[i % n].distanceTo(pts[i - 1]));
  const L = cum[n];
  if (L < 1e-9) return pts;
  const wrap = (x) => ((x % L) + L) % L;
  const at = (s) => {
    s = wrap(s);
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
    const f = (s - cum[lo]) / Math.max(1e-12, cum[lo + 1] - cum[lo]);
    return pts[lo].clone().lerp(pts[(lo + 1) % n], f);
  };
  const corners = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], p = pts[i], b = pts[(i + 1) % n];
    const d1 = p.clone().sub(a), d2 = b.clone().sub(p);
    if (d1.lengthSq() < 1e-18 || d2.lengthSq() < 1e-18) continue;
    if (d1.normalize().dot(d2.normalize()) < cosC) corners.push(i);
  }
  if (!corners.length) return pts;
  // corners only a hair apart (a tiny joining segment, like the 0.1 step in a heart's notch) are one corner
  const near = Math.max(radius * 0.3, L * 0.004);
  const groups = [];
  for (const i of corners) {
    const g = groups[groups.length - 1];
    if (g && cum[i] - g.b < near) g.b = cum[i]; else groups.push({ a: cum[i], b: cum[i] });
  }
  if (groups.length > 1) { const f = groups[0], l = groups[groups.length - 1]; if (wrap(f.a - l.b) < near) { f.a = l.a - L; groups.pop(); } }
  const m = groups.length;
  const fil = groups.map((g, j) => {
    const s = (g.a + g.b) / 2, span = (g.b - g.a) / 2;
    const prev = groups[(j - 1 + m) % m], next = groups[(j + 1) % m];
    const gapPrev = m === 1 ? L : wrap(g.a - prev.b) || L;
    const gapNext = m === 1 ? L : wrap(next.a - g.b) || L;
    // the corner's angle, read a little way along each side (one dense step on a curve is too short to trust)
    const e = span + Math.min(gapPrev, gapNext) * 0.1;
    const p = at(s), ua = at(s - e).sub(p).normalize(), ub = at(s + e).sub(p).normalize();
    const half = Math.acos(Math.max(-1, Math.min(1, ua.dot(ub)))) / 2;
    const t = span + Math.min(radius / Math.tan(Math.max(half, 1e-3)), gapPrev * 0.45, gapNext * 0.45);
    return { s, t, p };
  }).filter((f) => f.t > 1e-6);
  const inside = (s) => fil.some((f) => wrap(s - (f.s - f.t)) < 2 * f.t);
  const items = [];
  for (let k = 0; k < n; k++) if (!inside(cum[k])) items.push({ key: cum[k], pts: [pts[k]] });
  for (const f of fil) {
    const p1 = at(f.s - f.t), p2 = at(f.s + f.t), c = f.p;
    const steps = 10;
    const bend = [];
    for (let k = 0; k <= steps; k++) {
      const u = k / steps; // a quadratic curve from p1 to p2 pulled by the corner: tangent to both sides at its ends
      bend.push(p1.clone().multiplyScalar((1 - u) * (1 - u)).addScaledVector(c, 2 * u * (1 - u)).addScaledVector(p2, u * u));
    }
    items.push({ key: wrap(f.s - f.t), pts: bend });
  }
  items.sort((x, y) => x.key - y.key);
  return clean(items.flatMap((x) => x.pts));
}

// frame: the drawing's own box ({x, y, w, h}, the viewBox) — then 2 units are the whole frame, not the shape, and
// every icon of a set comes out at the same scale
function contours(shapes, step, cornerDeg, round = 0, frame = null) {
  const raw = shapes.map((s) => ({ outer: clean(s.getPoints(48)), holes: s.holes.map((h) => clean(h.getPoints(48))) })).filter((s) => s.outer.length > 2);
  const box = new THREE.Box2();
  if (frame) box.set(new THREE.Vector2(frame.x, frame.y), new THREE.Vector2(frame.x + frame.w, frame.y + frame.h));
  else raw.forEach((s) => s.outer.forEach((p) => box.expandByPoint(p)));
  const c = box.getCenter(new THREE.Vector2()), sz = box.getSize(new THREE.Vector2()), k = 2 / Math.max(sz.x, sz.y, 1e-6);
  const norm0 = (pts) => pts.map((p) => new THREE.Vector2((p.x - c.x) * k, -(p.y - c.y) * k));
  const norm = (pts) => filletCorners(norm0(pts), round, cornerDeg);
  return raw.map((s) => {
    const rawOuter = resample(norm(s.outer), step, cornerDeg);
    let outer = mult4(rawOuter);
    if (area(outer) < 0) outer = flip(outer);
    const hs = s.holes.filter((h) => h.length > 2);
    const holes = hs.map((h) => {
      let r = resample(norm(h), step, cornerDeg);
      // a smooth ring (no sharp corners on either side): the hole gets the outline's point count, so the cap
      // can be plain quad bands from edge to hole
      if (hs.length === 1 && !rawOuter.corners && !r.corners) r = resampleN(norm(h), outer.length);
      r = mult4(r);
      return area(r) > 0 ? flip(r) : r;
    });
    return { outer, holes };
  });
}

// Offset a loop to its left (into the material for CCW outer / CW holes), keeping the point count:
// every bevel ring has the same vertices, so the rings join with clean quads.
function offset(loop, d) {
  if (!d) return loop.map((p) => p.clone());
  const n = loop.length;
  const out = loop.map((p, i) => {
    const a = loop[(i - 1 + n) % n], b = loop[(i + 1) % n];
    const e1 = p.clone().sub(a).normalize(), e2 = b.clone().sub(p).normalize();
    const n1 = new THREE.Vector2(-e1.y, e1.x), n2 = new THREE.Vector2(-e2.y, e2.x);
    const m = n1.clone().add(n2);
    if (m.lengthSq() < 1e-9) m.copy(n1); else m.normalize();
    const miter = 1 / Math.max(0.35, m.dot(n1));
    return p.clone().addScaledVector(m, d * miter);
  });
  // next to a sharp tip the inset swallows a bit of each side, so a point can slide past the tip and the
  // loop folds. Such points are put back between their neighbours (the tip itself stays) — order is kept.
  const sharp = loop.map((p, i) => { const a = loop[(i - 1 + n) % n], b = loop[(i + 1) % n]; return p.clone().sub(a).normalize().dot(b.clone().sub(p).normalize()) < 0.7; });
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, o = loop[j].clone().sub(loop[i]);
      if (out[j].clone().sub(out[i]).dot(o) > 0.2 * o.lengthSq()) continue;
      if (!sharp[j]) out[j] = out[i].clone().lerp(out[(j + 1) % n], 0.5);
      else if (!sharp[i]) out[i] = out[(i - 1 + n) % n].clone().lerp(out[j], 0.5);
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

/* ---------- mesh: rings along a rounded profile, quads between them, caps ---------- */
function profile(depth, r, bseg, sseg) {
  const h = depth / 2, ring = [];
  r = Math.min(r, h * 0.98);
  if (r > 0) for (let i = 0; i <= bseg; i++) { const a = (i / bseg) * Math.PI / 2; ring.push({ inset: r * (1 - Math.sin(a)), z: h - r * (1 - Math.cos(a)) }); }
  else ring.push({ inset: 0, z: h });
  const top = ring[ring.length - 1].z;
  for (let s = 1; s < sseg; s++) ring.push({ inset: 0, z: top - (2 * top) * (s / sseg) });
  const back = ring.slice(0, r > 0 ? bseg + 1 : 1).reverse().map((p) => ({ inset: p.inset, z: -p.z }));
  return ring.concat(back);
}

// Holes: a chain of bridges «outer → hole 1 → hole 2 → … → outer» cuts the cap into two plain pieces (no
// repeated vertices — OBJ importers and Blender take those as clean n-gons, and each piece can be meshed on its
// own). Holes are chained along x, y or a diagonal (sorted, or nearest-neighbour for grids of holes); between
// neighbours the bridge is their closest pair of points that crosses nothing. The plan is checked: bridges cross no loop and no other bridge, both pieces are
// simple and together cover exactly the cap.
// Returns { o0, o1, order, ent, ext } — outer start/end points, holes in chain order, entry/exit point per hole.
function cutCap(O, Hs) {
  if (!Hs.length) return null;
  const segs = [];
  [O, ...Hs].forEach((L) => L.forEach((p, i) => segs.push([p, L[(i + 1) % L.length]])));
  const clear = (a, b) => segs.every(([c, d]) => !crosses(a, b, c, d));
  const capArea = THREE.ShapeUtils.area(O) - Hs.reduce((s2, H) => s2 + Math.abs(THREE.ShapeUtils.area(H)), 0);
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const cen = Hs.map((H) => H.reduce((acc, q) => acc.add(q), new THREE.Vector2()).multiplyScalar(1 / H.length));
  const orders = [];
  for (const [dx, dy] of dirs) {
    const pr = (q) => q.x * dx + q.y * dy;
    const sorted = cen.map((c, k) => [pr(c), k]).sort((u, v) => u[0] - v[0]).map((x) => x[1]);
    orders.push([dx, dy, sorted]);
    // nearest neighbour from the first one: zig-zags through grids of holes without long jumps
    const nn = [sorted[0]], left = new Set(sorted.slice(1));
    while (left.size) { const last = cen[nn[nn.length - 1]]; let b = -1; left.forEach((k) => { if (b < 0 || cen[k].distanceToSquared(last) < cen[b].distanceToSquared(last)) b = k; }); nn.push(b); left.delete(b); }
    if (nn.join() !== sorted.join()) orders.push([dx, dy, nn]);
  }
  for (const [dx, dy, order] of orders) {
    const proj = (q) => q.x * dx + q.y * dy;
    const K = order.length, ent = [], ext = [];
    // candidates nearest first; the (costly) crossing test runs only until one passes
    const firstClear = (cands) => { cands.sort((u, v) => u[0] - v[0]); for (const c of cands) if (clear(c[1], c[2])) return c; return null; };
    const nearO = (pt, side) => {
      const c = firstClear(O.map((q, i) => [q.distanceToSquared(pt), q, pt, i]).filter((x) => (side < 0 ? proj(x[1]) <= proj(pt) : proj(x[1]) >= proj(pt))));
      return c ? c[3] : -1;
    };
    const first = Hs[order[0]];
    ent[0] = first.reduce((m, q, i) => (proj(q) < proj(first[m]) ? i : m), 0);
    let ok = true;
    for (let t = 0; t + 1 < K && ok; t++) {
      const A = Hs[order[t]], B = Hs[order[t + 1]];
      const cands = [];
      A.forEach((q, i) => { if (i !== ent[t]) B.forEach((r, j) => cands.push([q.distanceToSquared(r), q, r, i, j])); });
      const c = firstClear(cands);
      if (!c) ok = false; else { ext[t] = c[3]; ent[t + 1] = c[4]; }
    }
    if (!ok) continue;
    const last = Hs[order[K - 1]];
    ext[K - 1] = last.reduce((m, q, i) => (i !== ent[K - 1] && (m < 0 || proj(q) > proj(last[m])) ? i : m), -1);
    const o0 = nearO(first[ent[0]], -1), o1 = ext[K - 1] < 0 ? -1 : nearO(last[ext[K - 1]], 1);
    if (o0 < 0 || o1 < 0 || o0 === o1) continue;
    const plan = { o0, o1, order, ent, ext };
    const br = bridgesOf(plan, O, Hs);
    if (br.some(([u, v], i) => !clear(u, v) || br.some(([c, d], j) => j > i && crosses(u, v, c, d)))) continue;
    const [pa, pb] = assemble(plan, O, Hs);
    const aa = THREE.ShapeUtils.area(pa), ab = THREE.ShapeUtils.area(pb);
    if (aa <= 0 || ab <= 0 || !simple(pa) || !simple(pb) || Math.abs(aa + ab - capArea) > Math.abs(capArea) * 1e-6) continue;
    return plan;
  }
  return null;
}
// the bridges of a plan as [from, to] pairs, in chain order (outer → … → outer)
function bridgesOf({ o0, o1, order, ent, ext }, O, Hs) {
  const out = [[O[o0], Hs[order[0]][ent[0]]]];
  for (let t = 0; t + 1 < order.length; t++) out.push([Hs[order[t]][ext[t]], Hs[order[t + 1]][ent[t + 1]]]);
  out.push([Hs[order[order.length - 1]][ext[order.length - 1]], O[o1]]);
  return out;
}
// The two pieces as lists of whatever O / Hs hold (points, vertex indices or refs). bridge(b) gives the points
// placed inside bridge b (walking it forward), if any.
function assemble({ o0, o1, order, ent, ext }, O, Hs, bridge = () => []) {
  const walk = (L, from, to) => { const r = [L[from]]; let i = from; while (i !== to) { i = (i + 1) % L.length; r.push(L[i]); } return r; };
  const K = order.length;
  // piece A: outer o1 → o0, then along the chain: each hole's arc from its entry to its exit
  const A = walk(O, o1, o0);
  for (let t = 0; t < K; t++) A.push(...bridge(t), ...walk(Hs[order[t]], ent[t], ext[t]));
  A.push(...bridge(K));
  // piece B: outer o0 → o1, then back along the chain on the other arc of each hole
  const B = walk(O, o0, o1);
  B.push(...bridge(K).slice().reverse());
  for (let t = K - 1; t >= 0; t--) B.push(...walk(Hs[order[t]], ext[t], ent[t]), ...bridge(t).slice().reverse());
  return [A, B];
}

// ---- quad caps: our own mesher for a flat cap (not a copy of any commercial remesher) ----
// loops: [outer (CCW), ...holes (CW)] — the cap edge, shared with the bevel. Steps:
// 1) edge loops follow the outline (and around holes), like a retopology gives;
// 2) 2→1 transition rings make the middle coarser than the edge («Сетка в середине»);
// 3) the middle: a ring with one hole — quad bands between them; one hole otherwise — cut by two bridges
//    into two pieces; each piece / a plain shape — a Coons grid, else a split fill if its quads are not
//    too thin, else a clean n-gon. Never a fan of slivers.
// Result: { pts, faces, kind } — a ref [k, i] is point i of loop k (shared with the wall), a number is pts[n].
const quadArea = (a, b, c, d) => THREE.ShapeUtils.area([a, b, c, d]);
const KIND_RANK = { grid: 0, split: 1, ngon: 2, tri: 3 };

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function minAngleDeg(f) {
  let m = 180;
  for (let i = 0; i < f.length; i++) {
    const p = f[i], a = f[(i - 1 + f.length) % f.length], b = f[(i + 1) % f.length];
    const u = a.clone().sub(p).normalize(), v = b.clone().sub(p).normalize();
    m = Math.min(m, Math.acos(Math.max(-1, Math.min(1, u.dot(v)))) * 180 / Math.PI);
  }
  return m;
}
const perimeter = (pts) => pts.reduce((s, p, i) => s + p.distanceTo(pts[(i + 1) % pts.length]), 0);

function capMesh(loops, P) {
  const pts = [], faces = [];
  const add = (p) => pts.push(p) - 1;
  const pos = (r) => (typeof r === 'number' ? pts[r] : loops[r[0]][r[1]]);
  const valid = (f) => quadArea(...f.map(pos)) > 1e-9;
  const holes = loops.length - 1;
  const box = new THREE.Box2().setFromPoints(loops[0]), sz = box.getSize(new THREE.Vector2());
  const maxInset = Math.min(sz.x, sz.y) * 0.22, gap = P.step * 0.9, cell = 2 / P.inner;
  let rings = loops.map((L, k) => L.map((_, i) => [k, i]));
  let inset = 0;
  // rings must not run into each other: hole rings stay inside the outer one, with some air between
  const apart = (pos2) => {
    if (pos2.length < 2) return true;
    const [o, ...hs] = pos2;
    for (let a = 0; a < hs.length; a++) {
      const h = hs[a];
      if (!h.every((p) => pointInPoly(p, o)) || o.some((p) => pointInPoly(p, h))) return false;
      for (const other of [o, ...hs.slice(a + 1)]) {
        if (other !== o && (h.some((p) => pointInPoly(p, other)) || other.some((p) => pointInPoly(p, h)))) return false;
        let d = Infinity;
        for (const p of h) for (const q of other) d = Math.min(d, p.distanceToSquared(q));
        if (Math.sqrt(d) <= gap * 0.6) return false;
      }
    }
    return true;
  };

  // 1) edge loops
  for (let k = 0; k < P.loops && inset + gap <= maxInset; k++) {
    const next = rings.map((r) => offset(r.map(pos), gap));
    // a loop that cuts through itself (thin arms of a plus under a wide bevel) ends the loops: the middle would fold
    let ok = next.every(simple) && apart(next);
    for (let g = 0; g < rings.length && ok; g++) {
      const r = rings[g], n = r.length;
      for (let i = 0; i < n && ok; i++) { const i1 = (i + 1) % n; if (quadArea(pos(r[i]), pos(r[i1]), next[g][i1], next[g][i]) <= 1e-9) ok = false; }
    }
    if (!ok) break;
    const nr = next.map((np) => np.map(add));
    rings.forEach((r, g) => { const n = r.length; for (let i = 0; i < n; i++) { const i1 = (i + 1) % n; faces.push([r[i], r[i1], nr[g][i1], nr[g][i]]); } });
    rings = nr; inset += gap;
  }

  const snaps = [];
  // 2) 2→1 transitions: every 4 edges of a ring become 2 (six quads per group), while the middle is finer than «cell»
  const reduce = (g) => {
    for (;;) {
      const r = rings[g], n = r.length;
      if (n < 16 || n % 4 || (P.maxSteps != null && snaps.length >= P.maxSteps)) return;
      const p = r.map(pos), edge = perimeter(p) / n;
      if (edge * 2 > cell * 1.25 || inset + edge * 1.6 > maxInset * 1.6) return;
      const d = edge * 1.6, mid = offset(p, d / 2), inn = offset(p, d);
      const others = rings.map((x, k) => (k === g ? inn.filter((_, i) => i % 2 === 0) : x.map(pos)));
      if (!simple(others[g]) || !apart(others)) return;
      const before = pts.length, nf = [];
      const inner = []; for (let t = 0; t < n / 2; t++) inner.push(add(inn[2 * t]));
      for (let q = 0; q < n / 4; q++) {
        const o = [0, 1, 2, 3, 4].map((k) => r[(4 * q + k) % n]);
        const a = add(mid[4 * q + 1]), b = add(mid[4 * q + 2]), c = add(mid[4 * q + 3]);
        const i0 = inner[2 * q], i1 = inner[2 * q + 1], i2 = inner[(2 * q + 2) % (n / 2)];
        nf.push([o[0], o[1], a, i0], [o[1], o[2], b, a], [o[2], o[3], c, b], [o[3], o[4], i2, c], [a, b, i1, i0], [b, c, i2, i1]);
      }
      if (!nf.every(valid)) { pts.length = before; return; }
      snaps.push({ pts: before, faces: faces.length, rings: rings.slice(), inset });
      faces.push(...nf); rings[g] = inner; inset += d;
    }
  };
  if (!holes) reduce(0);
  else if (holes === 1 && rings[0].length === rings[1].length) { // a ring: thin both sides together, so the bands still match
    for (;;) {
      const n0 = rings[0].length;
      reduce(0);
      if (rings[0].length === n0) break;
      reduce(1);
      if (rings[1].length !== rings[0].length) return null;
    }
  }

  // 3) the middle
  let kind = 'grid';
  const plan = (R) => {
    const L = R.map(pos);
    for (const fn of [gridFill, splitFill]) {
      const res = fn(L);
      if (!res) continue;
      const ma = Math.min(...res.faces.map((f) => minAngleDeg(f.map((x) => (x >= 0 ? L[x] : res.pts[-1 - x])))));
      if (res.kind === 'split' && ma < 14) continue; // thin slivers are worse than one clean n-gon
      return { kind: res.kind, apply: () => { const map = res.pts.map(add); res.faces.forEach((f) => faces.push(f.map((x) => (x >= 0 ? R[x] : map[-1 - x])))); } };
    }
    return { kind: 'ngon', apply: () => faces.push(R.slice()) };
  };
  const fillPiece = (R) => { const p = plan(R); p.apply(); if (KIND_RANK[p.kind] > KIND_RANK[kind]) kind = p.kind; };
  if (!holes) {
    // the grid did not fit the coarsened middle? step back one transition at a time and try again
    let best = null;
    for (;;) {
      const p = plan(rings[0]);
      if (!best || KIND_RANK[p.kind] < KIND_RANK[best.kind]) best = { ...p, snap: snaps.length };
      if (p.kind === 'grid' || !snaps.length) break;
      const s = snaps.pop();
      pts.length = s.pts; faces.length = s.faces; rings = s.rings; inset = s.inset;
    }
    if (best.snap !== snaps.length) {
      // the best try was at a deeper level: rebuild up to it (the transitions are deterministic)
      return capMesh.retry ? null : (capMesh.retry = true, (() => { const r = capMesh(loops, { ...P, maxSteps: best.snap }); capMesh.retry = false; return r; })());
    }
    best.apply();
    return { pts, faces, kind: best.kind };
  }

  const O = rings[0], H = rings[1], n = O.length;
  if (holes === 1 && n === H.length) {
    // a ring: quad bands from the outer edge to the hole, matched by the closest turn of the hole
    const Hc = H.map((_, i) => H[(n - i) % n]);
    let s0 = 0, best = Infinity;
    for (let s = 0; s < n; s++) { let e = 0; for (let i = 0; i < n; i += 4) e += pos(O[i]).distanceToSquared(pos(Hc[(i + s) % n])); if (e < best) { best = e; s0 = s; } }
    const dist = O.reduce((acc, r, i) => acc + pos(r).distanceTo(pos(Hc[(i + s0) % n])), 0) / n;
    const rows = Math.max(1, Math.round(dist / cell));
    const before = pts.length, nf = [];
    const grid = [O];
    for (let t = 1; t < rows; t++) grid.push(O.map((r, i) => add(pos(r).clone().lerp(pos(Hc[(i + s0) % n]), t / rows))));
    grid.push(O.map((_, i) => Hc[(i + s0) % n]));
    for (let t = 0; t < rows; t++) for (let i = 0; i < n; i++) { const i1 = (i + 1) % n; nf.push([grid[t][i], grid[t][i1], grid[t + 1][i1], grid[t + 1][i]]); }
    if (nf.every(valid)) { faces.push(...nf); return { pts, faces, kind }; }
    pts.length = before;
  }
  // holes, not a plain ring: a chain of bridges cuts the cap into two pieces, each meshed on its own
  const Op = O.map(pos), Hrs = rings.slice(1), Hps = Hrs.map((R) => R.map(pos));
  const cut = cutCap(Op, Hps);
  if (!cut) return null;
  const br = bridgesOf(cut, Op, Hps);
  // two or more holes: the pieces wind around every hole and never take a clean quad fill (and trying costs
  // seconds) — they stay clean n-gons, the edge loops around them are quads all the same
  if (holes > 1) {
    assemble(cut, O, Hrs).forEach((R) => faces.push(R));
    return { pts, faces, kind: 'ngon' };
  }
  const ks = br.map(([u, v]) => Math.max(0, Math.round(u.distanceTo(v) / cell) - 1));
  // quads need an even count around each piece: one more point on the first bridge fixes both pieces
  if (assemble(cut, O, Hrs, (bi) => new Array(ks[bi]).fill(0))[0].length % 2) ks[0]++;
  const bpts = br.map(([u, v], bi) => { const out = []; for (let t = 1; t <= ks[bi]; t++) out.push(add(u.clone().lerp(v, t / (ks[bi] + 1)))); return out; });
  assemble(cut, O, Hrs, (bi) => bpts[bi]).forEach(fillPiece);
  return { pts, faces, kind };
}

function smooth(pts, nbrs, fixed, it, faces, getP) {
  for (let t = 0; t < it; t++) {
    const prev = pts.map((p) => p.clone());
    pts.forEach((p, j) => {
      if (fixed && fixed.has(j)) return;
      const nb = nbrs[j];
      if (!nb || !nb.length) return;
      const c = new THREE.Vector2();
      nb.forEach((r) => c.add(getP(r)));
      p.copy(c.multiplyScalar(1 / nb.length));
    });
    // undo the step if it folded anything
    if (faces.some((f) => quadArea(...f.map(getP)) <= 1e-9)) { pts.forEach((p, j) => p.copy(prev[j])); break; }
  }
}

function gridFill(L) {
  const n = L.length, half = n / 2;
  const ib = new THREE.Box2().setFromPoints(L), is = ib.getSize(new THREE.Vector2());
  const corners = [ib.min, new THREE.Vector2(ib.max.x, ib.min.y), ib.max, new THREE.Vector2(ib.min.x, ib.max.y)];
  const a0 = Math.round(half * is.x / (is.x + is.y));
  const at = (i) => ((i % n) + n) % n;
  for (const da of [0, -1, 1, -2, 2, -3, 3]) {
    const a = a0 + da, b = half - a;
    if (a < 1 || b < 1) continue;
    const starts = [];
    for (let s = 0; s < n; s++) starts.push([[s, s + a, s + a + b, s + 2 * a + b].reduce((acc, i, k) => acc + L[at(i)].distanceToSquared(corners[k]), 0), s]);
    starts.sort((x, y) => x[0] - y[0]);
    for (const [, s0] of starts.slice(0, 6)) {
      const ref = (i, j) => {
        if (j === 0) return at(s0 + i);
        if (j === b) return at(s0 + 2 * a + b - i);
        if (i === 0) return at(s0 - j);
        if (i === a) return at(s0 + a + j);
        return -1 - ((j - 1) * (a - 1) + (i - 1));
      };
      const pts = [];
      const P = (r) => (r >= 0 ? L[r] : pts[-1 - r]);
      const P00 = L[ref(0, 0)], P10 = L[ref(a, 0)], P11 = L[ref(a, b)], P01 = L[ref(0, b)];
      for (let j = 1; j < b; j++) for (let i = 1; i < a; i++) {
        const u = i / a, v = j / b;
        pts.push(L[ref(i, 0)].clone().multiplyScalar(1 - v).addScaledVector(L[ref(i, b)], v)
          .addScaledVector(L[ref(0, j)], 1 - u).addScaledVector(L[ref(a, j)], u)
          .addScaledVector(P00, -(1 - u) * (1 - v)).addScaledVector(P10, -u * (1 - v))
          .addScaledVector(P01, -(1 - u) * v).addScaledVector(P11, -u * v));
      }
      const faces = [];
      for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) faces.push([ref(i, j), ref(i + 1, j), ref(i + 1, j + 1), ref(i, j + 1)]);
      const nbrs = [];
      for (let j = 1; j < b; j++) for (let i = 1; i < a; i++) nbrs[-1 - ref(i, j)] = [ref(i - 1, j), ref(i + 1, j), ref(i, j - 1), ref(i, j + 1)];
      if (faces.some((f) => quadArea(...f.map(P)) <= 1e-9)) {
        smooth(pts, nbrs, null, 40, [], P); // the raw patch folds: smoothing may untangle it
        if (faces.some((f) => quadArea(...f.map(P)) <= 1e-9)) continue;
      } else smooth(pts, nbrs, null, 30, faces, P);
      return { kind: 'grid', pts, faces };
    }
  }
  return null;
}

// Ear clipping that keeps every point (points on a straight run included — a general triangulator drops
// those, which would leave holes next to the loop), choosing the best-shaped ear each time.
function earClip(P) {
  const tri2 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inside = (p, a, b, c) => { const d1 = tri2(a, b, p), d2 = tri2(b, c, p), d3 = tri2(c, a, p); return d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12; };
  const minAngle = (a, b, c) => {
    const ang = (p, q, r) => { const u = q.clone().sub(p).normalize(), v = r.clone().sub(p).normalize(); return Math.acos(Math.max(-1, Math.min(1, u.dot(v)))); };
    return Math.min(ang(a, b, c), ang(b, c, a), ang(c, a, b));
  };
  const idx = P.map((_, i) => i), out = [];
  if (THREE.ShapeUtils.area(P) < 0) idx.reverse();
  while (idx.length > 3) {
    let best = -1, bq = -1;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const A = P[i0], B = P[i1], C = P[i2];
      if (tri2(A, B, C) <= 1e-9) continue;
      let blocked = false;
      for (const j of idx) if (j !== i0 && j !== i1 && j !== i2 && inside(P[j], A, B, C)) { blocked = true; break; }
      if (blocked) continue;
      const q = minAngle(A, B, C);
      if (q > bq) { bq = q; best = k; }
    }
    if (best < 0) return null;
    const n = idx.length;
    out.push([idx[(best - 1 + n) % n], idx[best], idx[(best + 1) % n]]);
    idx.splice(best, 1);
  }
  if (tri2(P[idx[0]], P[idx[1]], P[idx[2]]) <= 1e-9) return null;
  out.push(idx.slice());
  return out;
}

function splitFill(L) {
  const n = L.length, m = n / 2;
  const even = []; for (let k = 0; k < m; k++) even.push(L[2 * k]);
  let tris;
  tris = earClip(even);
  if (!tris) return null;
  const pts = [], mid = new Map(), faces = [];
  const P = (r) => (r >= 0 ? L[r] : pts[-1 - r]);
  const add = (p) => { pts.push(p); return -pts.length; };
  const edge = (k1, k2) => {
    const d = (k2 - k1 + m) % m;
    if (d === 1) return 2 * k1 + 1;            // a boundary edge: its middle is the skipped loop point
    if (d === m - 1) return 2 * k2 + 1;
    const key = Math.min(k1, k2) + '_' + Math.max(k1, k2);
    if (!mid.has(key)) mid.set(key, add(even[k1].clone().lerp(even[k2], 0.5)));
    return mid.get(key);
  };
  // every quad turns the way the loop itself turns (a piece of a cut cap can run clockwise; forcing one way flipped it)
  const turn = Math.sign(THREE.ShapeUtils.area(even)) || 1;
  for (let [x, y, z] of tris) {
    if (THREE.ShapeUtils.area([even[x], even[y], even[z]]) * turn < 0) [y, z] = [z, y];
    const A = 2 * x, B = 2 * y, C = 2 * z, ab = edge(x, y), bc = edge(y, z), ca = edge(z, x);
    const g = add(even[x].clone().add(even[y]).add(even[z]).multiplyScalar(1 / 3));
    faces.push([A, ab, g, ca], [B, bc, g, ab], [C, ca, g, bc]);
  }
  // neighbours for smoothing: the edges of the quads
  const nbrs = [];
  for (const f of faces) for (let i = 0; i < 4; i++) {
    const r = f[i], o1 = f[(i + 1) % 4], o3 = f[(i + 3) % 4];
    if (r < 0) { const j = -1 - r; nbrs[j] = nbrs[j] || []; [o1, o3].forEach((o) => { if (!nbrs[j].includes(o)) nbrs[j].push(o); }); }
  }
  if (faces.some((f) => quadArea(...f.map(P)) <= 1e-9)) return null;
  smooth(pts, nbrs, null, 20, faces, P);
  return { kind: 'split', pts, faces };
}

// Two segments cross (touching ends do not count).
function crosses(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
// A loop that does not cut through itself.
function simple(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (crosses(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
  }
  return true;
}
// How deep the bevel can go on this shape without its ring folding or cutting through itself (thin tips
// of a star are narrower than a wide bevel). The requested bevel is lowered to this when needed.
function safeBevel(loops, want) {
  const ok = (d) => loops.every((L) => {
    const o = offset(L, d), n = L.length;
    for (let i = 0; i < n; i++) { const i1 = (i + 1) % n; if (THREE.ShapeUtils.area([L[i], L[i1], o[i1], o[i]]) <= 1e-9) return false; }
    return simple(o);
  }) && (loops.length < 2 || loops.slice(1).every((h) => offset(h, d).every((p) => pointInPoly(p, offset(loops[0], d)))));
  if (ok(want)) return want;
  let lo = 0, hi = want;
  for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return lo * 0.9;
}

// Earcut leaves out points that lie on a straight run of the outline; each such point is put back by splitting the
// triangle whose edge it sits on (no T-junctions, no open edges).
function mendTris(tris, pts) {
  const used = new Set(tris.flat());
  const out = tris.map((t) => t.slice());
  pts.forEach((v, vi) => {
    if (used.has(vi)) return;
    let best = null, bd = Infinity;
    out.forEach((t, ti) => {
      for (let e = 0; e < 3; e++) {
        const a = pts[t[e]], b = pts[t[(e + 1) % 3]], ab = b.clone().sub(a), L2 = ab.lengthSq();
        if (!L2) continue;
        const u = v.clone().sub(a).dot(ab) / L2;
        if (u <= 1e-6 || u >= 1 - 1e-6) continue;
        const d = a.clone().addScaledVector(ab, u).distanceToSquared(v);
        if (d < bd) { bd = d; best = [ti, e]; }
      }
    });
    if (!best || bd > 1e-10) return;
    const [ti, e] = best, t = out[ti], a = t[e], b = t[(e + 1) % 3], c = t[(e + 2) % 3];
    out.splice(ti, 1, [a, vi, c], [vi, b, c]);
    used.add(vi);
  });
  return out;
}

// Every face gets a part (PART: front, back, bevel, wall — material slots in Blender) and the layout the UVs are
// made from: the walls and bevels of each loop are one strip of rings, the caps are flat.
const PART = { front: 0, back: 1, bevel: 2, wall: 3 };
const PART_NAMES = ['Лицо', 'Тыл', 'Фаска', 'Стенка'];
function build(cs, P) {
  const verts = [], faces = [], kinds = [], parts = [], strips = [], caps = [];
  let bevelCut = Infinity;
  for (const { outer, holes } of cs) {
    const loops = [outer, ...holes];
    const r = safeBevel(loops, Math.min(P.bevel, P.depth / 2 * 0.98));
    if (r < P.bevel - 1e-6) bevelCut = Math.min(bevelCut, r);
    const prof = profile(P.depth, r, P.bseg, P.sseg);
    const rings = loops.map((loop) => prof.map(({ inset, z }) => offset(loop, inset).map((p) => verts.push(new THREE.Vector3(p.x, p.y, z)) - 1)));
    // walls and bevels: quads only
    rings.forEach((R) => {
      strips.push({ R, prof, face0: faces.length });
      for (let j = 0; j < R.length - 1; j++) {
        const a = R[j], b = R[j + 1], n = a.length;
        const part = prof[j].inset > 1e-9 || prof[j + 1].inset > 1e-9 ? PART.bevel : PART.wall;
        for (let i = 0; i < n; i++) { faces.push([a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]]); parts.push(part); }
      }
    });
    // caps from the first and last ring (both sit at the same inset, so one cap mesh serves both)
    const cm = P.cap === 'quad' ? capMesh([offset(outer, prof[0].inset), ...holes.map((h) => offset(h, prof[0].inset))], P) : null;
    if (P.cap === 'quad') kinds.push(cm ? cm.kind : 'ngon');
    for (const front of [true, false]) {
      const ri = front ? 0 : prof.length - 1;
      const O = rings[0][ri], Hs = rings.slice(1).map((R) => R[ri]);
      const O2 = offset(outer, prof[ri].inset), H2 = holes.map((h, k) => offset(h, prof[ri].inset));
      if (cm) {
        const z = prof[ri].z, newIdx = cm.pts.map((p) => verts.push(new THREE.Vector3(p.x, p.y, z)) - 1);
        const R = (x) => (typeof x === 'number' ? newIdx[x] : rings[x[0]][ri][x[1]]);
        cm.faces.forEach((f) => { const g = f.map(R); faces.push(front ? g : g.slice().reverse()); });
        continue;
      }
      // n-gons: the whole cap, or two pieces cut by a chain of bridges through the holes
      let polys = null;
      if (!Hs.length) polys = [O.slice()];
      else { const plan = cutCap(O2, H2); if (plan) polys = assemble(plan, O, Hs); }
      if (polys && P.cap === 'tri') {
        // triangles from our own ear clipping: it keeps every outline point (a general triangulator drops the
        // points on straight runs and leaves degenerate, flipped triangles there)
        const pos2 = new Map();
        O.forEach((v, i) => pos2.set(v, O2[i])); Hs.forEach((H, k) => H.forEach((v, i) => pos2.set(v, H2[k][i])));
        const tris = [];
        for (const f of polys) {
          const t = earClip(f.map((v) => pos2.get(v)));
          if (!t) { tris.length = 0; break; }
          t.forEach(([a, b, c]) => tris.push([f[a], f[b], f[c]]));
        }
        if (tris.length) {
          tris.forEach((f) => { if (THREE.ShapeUtils.area(f.map((v) => pos2.get(v))) < 0) f.reverse(); faces.push(front ? f : f.slice().reverse()); });
          continue;
        }
        // ear clipping did not manage this piece: keep the clean n-gons instead of a risky triangulation
      }
      if (polys) {
        polys.forEach((f) => faces.push(front ? f : f.slice().reverse()));
      } else {
        const all = O2.concat(...H2), idx = O.concat(...Hs);
        const tris = mendTris(THREE.ShapeUtils.triangulateShape(O2, H2), all);
        tris.forEach((t) => { const f = t.map((i) => idx[i]); if (THREE.ShapeUtils.area(t.map((i) => all[i])) < 0) f.reverse(); faces.push(front ? f : f.slice().reverse()); });
      }
    }
    // the caps are flat: front at +z, back at −z — one island each per shape
    const fr = [], bk = [];
    for (let i = parts.length; i < faces.length; i++) { const isFront = verts[faces[i][0]].z > 0; parts.push(isFront ? PART.front : PART.back); (isFront ? fr : bk).push(i); }
    caps.push({ faces: fr, back: false }, { faces: bk, back: true });
  }
  const kind = kinds.reduce((w, k) => (KIND_RANK[k] > KIND_RANK[w] ? k : w), 'grid');
  const mesh = { verts, faces, parts, kind: P.cap === 'quad' ? kind : P.cap, bevel: bevelCut === Infinity ? null : bevelCut };
  // the smoothing angle for Blender: smooth across the bevel's own steps (90° / segments), sharp at the outline's corners
  mesh.smoothDeg = Math.min(60, Math.max(30, 90 / Math.max(1, P.bseg) + 6));
  mesh.uv = layoutUV(mesh, strips, caps);
  return mesh;
}

/* ---------- UVs straight from the shape: no unwrapping needed ---------- */
// Caps lie flat as they are (the back mirrored, so it reads the right way round). The walls and bevels of a loop
// are a strip of rings: u runs along the outline, v down the profile — a straight ribbon with no stretch. Long
// ribbons are cut into a few pieces (at the sharpest corners near even spacing) so they pack well. One texel
// density for everything; islands are shelf-packed into the 0–1 square. → per face, a [u, v] per corner.
function layoutUV(mesh, strips, caps) {
  const { verts, faces } = mesh;
  const uv = faces.map((f) => f.map(() => [0, 0]));
  const islands = []; // { w, h, put: (ox, oy, k) => void }
  for (const c of caps) {
    if (!c.faces.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const P2 = (v) => [c.back ? -verts[v].x : verts[v].x, verts[v].y];
    c.faces.forEach((fi) => faces[fi].forEach((v) => { const [x, y] = P2(v); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
    islands.push({ w: x1 - x0, h: y1 - y0, put: (ox, oy, k) => c.faces.forEach((fi) => faces[fi].forEach((v, j) => { const [x, y] = P2(v); uv[fi][j] = [ox + (x - x0) * k, oy + (y - y0) * k]; })) });
  }
  for (const { R, prof, face0 } of strips) {
    const n = R[0].length, rows = R.length - 1;
    // v: length down the profile; u: length along the ring with no inset (the wall), the bevel rings follow it
    const vAt = [0];
    for (let j = 1; j < R.length; j++) vAt.push(vAt[j - 1] + Math.hypot(prof[j].inset - prof[j - 1].inset, prof[j].z - prof[j - 1].z));
    const mid = R[prof.findIndex((p) => p.inset < 1e-9)] || R[0];
    const uAt = [0];
    for (let i = 1; i <= n; i++) uAt.push(uAt[i - 1] + verts[mid[i - 1]].distanceTo(verts[mid[i % n]]));
    const L = uAt[n], H = vAt[rows];
    if (L < 1e-9 || H < 1e-9) continue;
    // pieces: about 6 : 1 at most; cuts go to the sharpest turn near each even split
    const k = Math.max(1, Math.min(Math.floor(n / 4), Math.round(L / (H * 6))));
    const turn = (i) => { const a = verts[mid[(i - 1 + n) % n]], b = verts[mid[i]], c = verts[mid[(i + 1) % n]]; return 1 - b.clone().sub(a).normalize().dot(c.clone().sub(b).normalize()); };
    const cuts = [];
    for (let q = 0; q < k; q++) {
      const want = (q / k) * L, win = L / k / 4;
      let best = -1, score = -Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.min(Math.abs(uAt[i] - want), L - Math.abs(uAt[i] - want));
        if (d > win || cuts.includes(i)) continue;
        const sc = turn(i) - d / (L * 4);
        if (sc > score) { score = sc; best = i; }
      }
      if (best < 0) best = Math.round((q / k) * n) % n;
      if (!cuts.includes(best)) cuts.push(best);
    }
    cuts.sort((a, b) => a - b);
    cuts.forEach((a, ci) => {
      const b = ci + 1 < cuts.length ? cuts[ci + 1] : cuts[0] + n; // the piece runs a → b (b may pass n: it wraps)
      const uOf = (s2) => (s2 <= n ? uAt[s2] : L + uAt[s2 - n]) - uAt[a];
      const len = uOf(b);
      islands.push({ w: len, h: H, put: (ox, oy, sc) => {
        for (let j = 0; j < rows; j++) for (let s2 = a; s2 < b; s2++) {
          const fi = face0 + j * n + (s2 % n);
          const u0 = uOf(s2) * sc, u1 = uOf(s2 + 1) * sc, v0 = (H - vAt[j]) * sc, v1 = (H - vAt[j + 1]) * sc;
          // face = [ring j · i, ring j+1 · i, ring j+1 · i+1, ring j · i+1]; ring j is on top (v counts downwards)
          uv[fi] = [[ox + u0, oy + v0], [ox + u0, oy + v1], [ox + u1, oy + v1], [ox + u1, oy + v0]];
        }
      } });
    });
  }
  packShelves(islands);
  return uv;
}

// shelves, tallest first; the shelf width is tried a few ways and the most square layout wins
function packShelves(islands) {
  if (!islands.length) return;
  const total = islands.reduce((s, i) => s + i.w * i.h, 0);
  const gap = Math.sqrt(total) * 0.02;
  const order = islands.slice().sort((a, b) => b.h - a.h);
  const widest = Math.max(...islands.map((i) => i.w));
  let best = null;
  for (const f of [0.9, 1.0, 1.1, 1.2, 1.35, 1.5, 1.8]) {
    const W = Math.max(widest, Math.sqrt(total) * f);
    let x = 0, y = 0, rowH = 0, maxW = 0;
    const at = [];
    for (const it of order) {
      if (x > 0 && x + it.w > W) { y += rowH + gap; x = 0; rowH = 0; }
      at.push([x, y]); x += it.w + gap; rowH = Math.max(rowH, it.h); maxW = Math.max(maxW, x - gap);
    }
    const side = Math.max(maxW, y + rowH);
    if (!best || side < best.side) best = { side, at };
  }
  const m = 0.01, k = (1 - 2 * m) / best.side;
  order.forEach((it, i) => it.put(m + best.at[i][0] * k, m + best.at[i][1] * k, k));
}


// OBJ keeps quads and n-gons as they are (Blender imports them unchanged)
// A mesh from the generator also carries its UVs (vt) and parts (usemtl Лицо, Тыл, Фаска, Стенка — material slots)
export function toOBJ(mesh, name = 'PerchSVG') {
  // «# oddments-smooth N»: the add-on smooths the model by this angle on import (it has no normals of its own)
  const lines = ['# Oddments — SVG → 3D', ...(mesh.smoothDeg ? ['# oddments-smooth ' + mesh.smoothDeg.toFixed(1)] : []), 'o ' + name.replace(/\s+/g, '_')];
  mesh.verts.forEach((v) => lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`));
  if (!mesh.uv || !mesh.parts) {
    mesh.faces.forEach((f) => lines.push('f ' + f.map((i) => i + 1).join(' ')));
    return lines.join('\n') + '\n';
  }
  const vt = new Map();
  const ref = mesh.uv.map((cs) => cs.map(([u, v]) => {
    const key = u.toFixed(6) + ' ' + v.toFixed(6);
    if (!vt.has(key)) { vt.set(key, vt.size + 1); lines.push('vt ' + key); }
    return vt.get(key);
  }));
  PART_NAMES.forEach((pn, p) => {
    const fs = [];
    mesh.faces.forEach((f, i) => { if (mesh.parts[i] === p) fs.push('f ' + f.map((v, j) => (v + 1) + '/' + ref[i][j]).join(' ')); });
    if (fs.length) lines.push('usemtl ' + pn, ...fs);
  });
  return lines.join('\n') + '\n';
}

// The same mesh as compact JSON for the Blender add-on (bridge /mesh): it builds the object itself with bmesh
export function toMeshJSON(mesh) {
  const r = (x) => Math.round(x * 1e6) / 1e6;
  return { v: mesh.verts.flatMap((p) => [r(p.x), r(p.y), r(p.z)]), f: mesh.faces, p: mesh.parts || [], uv: mesh.uv ? mesh.uv.map((cs) => cs.flatMap(([u, v]) => [r(u), r(v)])) : [], parts: PART_NAMES };
}

// A model without errors: every edge between exactly two faces that run opposite ways, no face of zero area.
export function checkMesh(verts, faces) {
  const edges = new Map();
  let degenerate = 0;
  for (const f of faces) {
    const n = new THREE.Vector3();
    for (let i = 0; i < f.length; i++) { const a = verts[f[i]], b = verts[f[(i + 1) % f.length]]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
    if (n.length() < 1e-10) degenerate++;
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length], key = a < b ? a + '_' + b : b + '_' + a;
      const e = edges.get(key) || { n: 0, dir: 0 };
      e.n++; e.dir += a < b ? 1 : -1;
      edges.set(key, e);
    }
  }
  let open = 0, flipped = 0;
  for (const e of edges.values()) { if (e.n !== 2) open++; else if (e.dir !== 0) flipped++; }
  return { ok: !open && !degenerate && !flipped, open, degenerate, flipped };
}

// Reads an OBJ (vertices and faces only — what the remesher writes) into { verts, faces }.
export function parseOBJ(text) {
  const verts = [], faces = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) { const [, x, y, z] = line.trim().split(/\s+/); verts.push(new THREE.Vector3(+x, +y, +z)); }
    else if (line.startsWith('f ')) faces.push(line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1));
  }
  return { verts, faces };
}

// Triangles for display: quads and n-gons are split only for the screen; the file keeps them whole.
export function toGeometry(mesh) {
  const pos = [];
  const tri = (a, b, c) => [a, b, c].forEach((i) => pos.push(mesh.verts[i].x, mesh.verts[i].y, mesh.verts[i].z));
  for (const f of mesh.faces) {
    if (f.length === 3) tri(f[0], f[1], f[2]);
    else if (f.length === 4) { tri(f[0], f[1], f[2]); tri(f[0], f[2], f[3]); }
    else {
      // n-gons only appear on flat caps (z = const): triangulate them in the plane
      const pts = f.map((i) => new THREE.Vector2(mesh.verts[i].x, mesh.verts[i].y));
      const front = mesh.verts[f[0]].z > 0;
      THREE.ShapeUtils.triangulateShape(pts, []).forEach(([a, b, c]) => ((THREE.ShapeUtils.area([pts[a], pts[b], pts[c]]) > 0) === front ? tri(f[a], f[b], f[c]) : tri(f[a], f[c], f[b])));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// the wireframe of the real faces (quads stay quads)
export function toEdges(mesh) {
  const seen = new Set(), lp = [];
  for (const f of mesh.faces) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length], key = a < b ? a + '_' + b : b + '_' + a;
    if (seen.has(key)) continue;
    seen.add(key);
    lp.push(mesh.verts[a].x, mesh.verts[a].y, mesh.verts[a].z, mesh.verts[b].x, mesh.verts[b].y, mesh.verts[b].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  return g;
}

export { parseSvg, contours, build, KIND_RANK, PART_NAMES };
export const _internals = { capMesh, cutCap, offset, mendTris }; // for the fuzz checks in the browser console
