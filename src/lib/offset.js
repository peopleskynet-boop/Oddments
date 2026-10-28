// Exact offsets for the icon constructor. paperjs-offset approximates the offset of each Bézier curve and leaves
// waves and kinks on rounded corners (an Outline's inner edge, bug #73). Here a shape is flattened into a dense
// polygon (error < 0.002 px), offset by Clipper (clipper-lib 6.4, © Angus Johnson, Boost licence; the clipper2-js
// port leaves zigzags when shrinking) — exact for polygons, round joins and caps as true arcs — and fitted back into smooth Bézier curves; sharp corners (where a cut meets the outline) stay sharp.
import paper from 'paper';
import ClipperLib from 'clipper-lib';

const { ClipperOffset, Clipper, JoinType, EndType, PolyFillType, Paths } = ClipperLib;

const SCALE = 1e5;      // Clipper works in integers: 1 unit = 0.00001 px
const FLAT = 0.002;     // flattening error (px on the 24 grid)
const ARC = 0.0015;     // the largest gap between a true arc and its polygon
const FIT = 0.004 ** 2;  // fitted curves stay within 0.004 px of the polygon (paper's fitter takes it squared)
const STEP = 0.25;      // long straight edges get points every 0.25 px, so a curve cannot sag between two far vertices
const CORNER = 28;      // a turn sharper than this (degrees) between neighbouring edges is a corner

function toPolys(item) {
  const c = item.clone({ insert: false });
  const paths = c.className === 'CompoundPath' ? c.children : [c];
  const out = [];
  for (const p of paths) {
    const q = p.clone({ insert: false });
    q.flatten(FLAT);
    const pts = q.segments.map((s) => ({ X: Math.round(s.point.x * SCALE), Y: Math.round(s.point.y * SCALE) }));
    if (pts.length > 2) out.push(pts);
  }
  return out;
}

function toPolyline(item) {
  const q = item.clone({ insert: false });
  q.flatten(FLAT);
  return q.segments.map((s) => ({ X: Math.round(s.point.x * SCALE), Y: Math.round(s.point.y * SCALE) }));
}

function run(paths, delta, end, join = JoinType.jtRound, miter = 2) {
  const co = new ClipperOffset(miter, ARC * SCALE);
  co.AddPaths(paths, join, end);
  const sol = new Paths();
  co.Execute(sol, delta * SCALE);
  return sol;
}

// polygon → smooth closed path: split at sharp corners, fit each run with curves, join them back
function fitClosed(poly) {
  const raw = poly.map((p) => new paper.Point(p.X / SCALE, p.Y / SCALE));
  const pts = [];
  let seam = 0, longest = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i], b = raw[(i + 1) % raw.length], len = a.getDistance(b), k = Math.floor(len / STEP);
    if (len > longest) { longest = len; seam = pts.length + Math.floor((k + 1) / 2); }
    pts.push(a);
    for (let j = 1; j <= k; j++) pts.push(a.add(b.subtract(a).multiply(j / (k + 1))));
  }
  const n = pts.length;
  if (n < 3) return null;
  const corner = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const v1 = b.subtract(a), v2 = c.subtract(b);
    if (!v1.length || !v2.length) continue;
    if (Math.abs(v1.getDirectedAngle(v2)) > CORNER) corner.push(i);
  }
  const path = new paper.Path({ closed: true, insert: false });
  // A smooth contour (a circle, a capsule) is fitted as two open halves: paper's fitter closes a closed path badly
  // (a flat spot or a bump at the seam). The seams sit in the middle of the longest straight edge, where a curve has
  // nothing to bend, and their handles are lined up afterwards.
  const seams = [];
  if (!corner.length) {
    const s0 = seam % n, s1 = (s0 + Math.floor(n / 2)) % n;
    corner.push(Math.min(s0, s1), Math.max(s0, s1));
    seams.push(pts[s0], pts[s1]);
  }
  for (let k = 0; k < corner.length; k++) {
    const from = corner[k], to = corner[(k + 1) % corner.length];
    const runPts = [];
    for (let i = from; ; i = (i + 1) % n) {
      runPts.push(pts[i]);
      if (i === to && runPts.length > 1) break;
      if (runPts.length > n + 1) break;
    }
    const f = new paper.Path({ segments: runPts, insert: false });
    if (runPts.length > 2) f.simplify(FIT);
    const segs = f.segments.map((s) => new paper.Segment(s.point, s.handleIn, s.handleOut));
    if (path.segments.length) {
      // the corner point is the last of this run and the first of the next one: keep one, with both handles
      const last = path.lastSegment;
      last.handleOut = segs[0].handleOut;
      segs.shift();
    } else {
      segs[0].handleIn = new paper.Point(0, 0);
    }
    path.addSegments(segs);
  }
  // the first and last segments are the same corner
  if (path.segments.length > 1 && path.firstSegment.point.getDistance(path.lastSegment.point) < 1e-6) {
    path.firstSegment.handleIn = path.lastSegment.handleIn;
    path.lastSegment.remove();
  }
  for (const sp of seams) {
    const g = path.segments.find((x) => x.point.getDistance(sp) < 1e-9);
    if (!g) continue;
    const li = g.handleIn.length, lo = g.handleOut.length;
    let dir = g.handleOut.subtract(g.handleIn);
    if (!dir.length) dir = g.next.point.subtract(g.previous.point);
    dir = dir.normalize();
    g.handleIn = dir.multiply(-li);
    g.handleOut = dir.multiply(lo);
  }
  return path;
}

function toItem(sol) {
  const kids = sol.map(fitClosed).filter(Boolean);
  if (!kids.length) return null;
  const cp = new paper.CompoundPath({ children: kids, insert: false });
  // Clipper's solution has no overlaps; outer contours and holes get paper's orientation for later booleans
  if (cp.reorient) cp.reorient(true, true);
  return kids.length === 1 ? kids[0] : cp;
}

// a closed shape grown (d > 0) or shrunk (d < 0) by d, round joins
export function offsetShape(item, d) {
  if (!item) return null;
  const polys = Clipper.SimplifyPolygons(toPolys(item), PolyFillType.pftNonZero);
  const sol = run(polys, d, EndType.etClosedPolygon);
  return toItem(sol);
}

// an open line (or polyline) as a filled stroke of width w; round caps and joins unless the SVG says otherwise
// (svgfix.js: cap butt / square, join miter / bevel, a closed contour's stroke). The constants above are in px of
// the 24 grid, so a drawing in another frame passes `size` and is worked on scaled to 24.
const CAPS = { round: EndType.etOpenRound, butt: EndType.etOpenButt, square: EndType.etOpenSquare };
const JOINS = { round: JoinType.jtRound, miter: JoinType.jtMiter, bevel: JoinType.jtSquare };
export function strokeShape(line, w, { cap = 'round', join = 'round', closed = false, miter = 4, size = 24 } = {}) {
  const k = 24 / size, l = line.clone({ insert: false });
  if (k !== 1) l.scale(k, new paper.Point(0, 0));
  const end = closed ? EndType.etClosedLine : CAPS[cap] || EndType.etOpenRound;
  const sol = run([toPolyline(l)], (w * k) / 2, end, JOINS[join] || JoinType.jtRound, Math.max(1, miter));
  const out = toItem(sol);
  if (out && k !== 1) out.scale(1 / k, new paper.Point(0, 0));
  return out;
}

/* ---------- «Умный 16» in polygons (iconkit.js smartSmall) ----------
   The fitted-curve offsets above cost ~70 ms each; the small-size fixes need a dozen of them. Here every step stays a
   Clipper polygon (a coarser arc tolerance, nothing fitted) and only the result becomes curves again: ~20× faster. */
const ARC_FAST = 0.01;
function offP(paths, d) {
  const co = new ClipperOffset(2, ARC_FAST * SCALE);
  co.AddPaths(paths, JoinType.jtRound, EndType.etClosedPolygon);
  const sol = new Paths();
  co.Execute(sol, d * SCALE);
  return sol;
}
function bool(type, a, b) {
  const c = new Clipper();
  c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
  const sol = new Paths();
  c.Execute(type, sol, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return sol;
}
const areaP = (p) => Math.abs(p.reduce((s, q) => s + Clipper.Area(q), 0)) / (SCALE * SCALE);
const { ctUnion, ctDifference, ctIntersection } = ClipperLib.ClipType;

// thin parts (narrower than ~0.9 line) grow by `step`, then gaps narrower than a line widen (gaps win), the result is
// clipped to [m, size − m]. Returns { item, thick, wider } — the new paper item and which fixes happened.
export function smallFix(item, t, step, m, size) {
  let f = Clipper.SimplifyPolygons(toPolys(item), PolyFillType.pftNonZero);
  const a = t * 0.45, min = t * t * 0.3;
  const res = { thick: false, wider: false };
  // what opening / closing finds also holds the slivers of every convex / concave corner; a second, small opening
  // keeps only real bars and channels (a 1.33 px bar survives it, a corner wedge does not)
  const real = (p) => offP(offP(p, -0.22), 0.22);
  const opened = offP(offP(f, -a), a);
  const thin = real(bool(ctDifference, f, opened));
  // thicken inwards only (into holes and cut-outs): the outer edge stays where it is, so nothing gets flattened
  // against the margins
  const big = f.reduce((m, q) => (Math.abs(Clipper.Area(q)) > Math.abs(Clipper.Area(m)) ? q : m), f[0] || []);
  const outerSign = Math.sign(Clipper.Area(big));
  const outer = f.filter((q) => Math.sign(Clipper.Area(q)) === outerSign);
  if (areaP(thin) >= min) { f = bool(ctUnion, f, bool(ctIntersection, offP(thin, step), outer)); res.thick = true; }
  for (let pass = 0; pass < 2; pass++) {
    const closed = offP(offP(f, a), -a);
    const gaps = real(bool(ctDifference, closed, f));
    if (areaP(gaps) < min) break;
    f = bool(ctDifference, f, offP(gaps, step));
    res.wider = true;
  }
  const lo = Math.round(m * SCALE), hi = Math.round((size - m) * SCALE);
  f = bool(ctIntersection, f, [[{ X: lo, Y: lo }, { X: hi, Y: lo }, { X: hi, Y: hi }, { X: lo, Y: hi }]]);
  res.item = toItem(f);
  return res;
}
