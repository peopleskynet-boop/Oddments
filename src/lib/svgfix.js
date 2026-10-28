// «Исправить SVG»: a drawing with broken points becomes a clean one, the look unchanged (every edge stays within a
// hair of where it was: 0.15 % of the frame). What it fixes:
// - point noise — traced and auto-exported files carry a point every few units, wobbly straight sides and corners
//   cut into stairs: each contour is read as a dense polyline, sharp corners are found over a window (not from
//   neighbouring points, which the noise turns every which way), straight runs become one line, the rest is fitted
//   with as few smooth curves as the tolerance allows;
// - doubled and hair-short segments, «almost smooth» kinks (a few degrees off a tangent);
// - lines a hair off horizontal or vertical (moved onto the axis only when that moves them within the tolerance);
// - self-crossing contours and shapes lying over each other: one clean outline per colour (paper's booleans, the
//   file's own fill-rule respected), holes stay holes;
// - open filled contours (closed), crumbs smaller than half a percent of the frame (dropped);
// - strokes become outlines (the stroke's width, caps and joins), so 3D and any fill-only tool see them;
// - transforms are baked in, coordinates rounded to what the frame needs.
// A contour that was already clean keeps its own points. The original file is never touched: the result is a new text.
// → { svg, report, preview: { frame, before: [d], after: [{ d, fill }], ptsBefore, ptsAfter } }
import paper from 'paper';
import { strokeShape } from './offset.js';

let ready = false;
function setup() {
  if (ready) return;
  if (!paper.project) { const c = document.createElement('canvas'); c.width = c.height = 64; paper.setup(c); }
  ready = true;
}

// how far an edge may move, of the frame's larger side: «бережно / обычно / сильно»
export const STRENGTH = { soft: 0.0015, normal: 0.003, strong: 0.006 };
const CORNER = 28;       // a turn sharper than this (degrees, read over a window) is a corner
const KINK = 25;         // a joint off its tangent by less than this was meant to be smooth
const AXIS = 2;          // a line within this many degrees of horizontal / vertical goes onto the axis
const JUNK = 0.005;      // pieces smaller than this (of the frame, each way) are crumbs

function frameOf(root) {
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3], vb: true };
  const w = parseFloat(root.getAttribute('width')), h = parseFloat(root.getAttribute('height'));
  if (w > 0 && h > 0) return { x: 0, y: 0, w, h, vb: false };
  return null;
}

const P = (x, y) => new paper.Point(x, y);
const segCount = (it) => (it.className === 'CompoundPath' ? it.children.reduce((n, c) => n + c.segments.length, 0) : it.segments.length);
const hexOf = (c) => (c ? c.toCSS(true) : '#000000');
const visible = (c, k = 1) => c && c.alpha * k > 0.02;

// the contour as a dense polyline (curves flattened finely), doubled points dropped
function polyOf(path, tol) {
  const q = path.clone({ insert: false });
  q.flatten(tol * 0.15);
  const out = [];
  for (const s of q.segments) if (!out.length || out[out.length - 1].getDistance(s.point) > tol * 0.02) out.push(s.point);
  if (path.closed && out.length > 2 && out[0].getDistance(out[out.length - 1]) < tol * 0.02) out.pop();
  return out;
}

// small loops and back-and-forth spikes of the polyline (a contour that crosses itself for a few units, a point that
// doubles back) are cut out: a loop shorter than `maxLen` becomes its crossing point. → number of loops cut
function segX(a, b, c, d) {
  const r = b.subtract(a), q = d.subtract(c), den = r.cross(q);
  if (Math.abs(den) < 1e-12) return null;
  const t = c.subtract(a).cross(q) / den, u = c.subtract(a).cross(r) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? a.add(r.multiply(t)) : null;
}
function untangle(pts, closed, maxLen) {
  let fixes = 0;
  for (let guard = 0; guard < 200; guard++) {
    const n = pts.length;
    if (n < 4) break;
    let hit = null;
    for (let i = 0; i < n && !hit; i++) {
      if (!closed && i >= n - 1) break;
      const a = pts[i], b = pts[(i + 1) % n];
      let len = 0;
      for (let k = 2; k < n - 1; k++) {
        if (!closed && i + k >= n - 1) break;
        const j = (i + k) % n;
        len += pts[(i + k - 1) % n].getDistance(pts[j]);
        if (len > maxLen) break;
        const x = segX(a, b, pts[j], pts[(j + 1) % n]);
        if (x) hit = { i, j, x };
        if (hit) break;
      }
    }
    if (hit) {
      const { i, j, x } = hit;
      let next;
      if (closed) { next = [x]; for (let k = (j + 1) % n; ; k = (k + 1) % n) { next.push(pts[k]); if (k === i) break; } }
      else next = [...pts.slice(0, i + 1), x, ...pts.slice(j + 1)];
      pts.splice(0, pts.length, ...next);
      fixes++; // a loop: the contour crossed itself
      continue;
    }
    // a point that doubles back on a short leg
    let spike = -1;
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const u = b.subtract(a), v = c.subtract(b);
      if (!u.length || !v.length) { spike = i; break; }
      if (Math.abs(u.getDirectedAngle(v)) > 165 && Math.min(u.length, v.length) < maxLen / 4) { spike = i; break; }
    }
    if (spike < 0) break;
    pts.splice(spike, 1); // a spike is noise, not a crossing: not counted
  }
  return fixes;
}

// corners: the turn between a chord back and a chord ahead (each `w` long along the contour), local maxima only
function cornersOf(pts, closed, w) { // w: at least a few tolerances, so the noise does not read as a turn
  const n = pts.length, cum = [0];
  for (let i = 1; i < n + (closed ? 1 : 0); i++) cum.push(cum[i - 1] + pts[i % n].getDistance(pts[i - 1]));
  const L = cum[cum.length - 1];
  const at = (s) => {
    if (closed) s = ((s % L) + L) % L; else s = Math.max(0, Math.min(L, s));
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const f = (s - cum[lo]) / Math.max(1e-12, cum[hi] - cum[lo]);
    return pts[lo % n].add(pts[hi % n].subtract(pts[lo % n]).multiply(f));
  };
  const turnAt = (i, w0) => {
    if (!closed && (i === 0 || i === n - 1)) return 0;
    const ww = closed ? Math.min(w0, L / 6) : Math.min(w0, cum[i], L - cum[i]);
    if (ww < 1e-9) return 0;
    const a = pts[i].subtract(at(cum[i] - ww)), b = at(cum[i] + ww).subtract(pts[i]);
    if (a.length < 1e-9 || b.length < 1e-9) return 0;
    return Math.abs(a.getDirectedAngle(b));
  };
  // a corner turns at a point: read over a third of the window it still turns nearly as much; a round cap or a bend
  // spreads its turn, so the narrow read sees a third of it
  const turn = pts.map((p, i) => {
    const t = turnAt(i, w);
    if (t < CORNER) return t;
    const tn = turnAt(i, w / 3);
    return tn >= t * 0.6 && tn >= CORNER * 0.8 ? t : 0;
  });
  const out = [];
  const dist = (i, j) => { const d = Math.abs(cum[i] - cum[j]); return closed ? Math.min(d, L - d) : d; };
  for (let i = 0; i < n; i++) {
    if (turn[i] < CORNER) continue;
    let best = true; // a local maximum within the window (ties go to the first point)
    for (let j = 0; j < n && best; j++) if (j !== i && dist(i, j) <= w && (turn[j] > turn[i] || (turn[j] === turn[i] && j < i))) best = false;
    if (best) out.push(i);
  }
  return out;
}

const devFromChord = (run) => {
  const a = run[0], b = run[run.length - 1], d = b.subtract(a), L = d.length;
  let m = 0;
  for (const p of run) m = Math.max(m, L < 1e-12 ? p.getDistance(a) : Math.abs(d.cross(p.subtract(a))) / L);
  return m;
};

// the polyline cut at `splits` (indices), each run a line or a few fitted curves, joined into one path. `align` marks
// split points that are smooth joints, not corners: 'h' / 'v' — an extreme point of the shape (its handles lie flat,
// horizontal or vertical), 'line' — the end of a straight side, 'seam' — a cut in a smooth loop (handles on one line)
function fitRuns(pts, closed, splits, tol, align) {
  const n = pts.length, runs = [];
  if (closed) {
    for (let k = 0; k < splits.length; k++) {
      const a = splits[k], b = splits[(k + 1) % splits.length], run = [];
      for (let i = a; ; i = (i + 1) % n) { run.push(pts[i]); if (i === b && run.length > 1) break; }
      runs.push({ run, a });
    }
  } else {
    const ends = [...new Set([0, ...splits, n - 1])].sort((x, y) => x - y);
    for (let k = 0; k < ends.length - 1; k++) runs.push({ run: pts.slice(ends[k], ends[k + 1] + 1), a: ends[k] });
  }
  const path = new paper.Path({ insert: false, closed });
  for (const { run, a } of runs) {
    let segs;
    if (run.length < 3 || devFromChord(run) <= tol) segs = [new paper.Segment(run[0]), new paper.Segment(run[run.length - 1])];
    else if ((segs = oneCurve(run, tol))) { /* one curve from anchor to anchor fits */ }
    else {
      const f = new paper.Path({ segments: run, insert: false });
      f.simplify(tol * tol);
      segs = f.segments.map((x) => new paper.Segment(x.point, x.handleIn, x.handleOut));
      for (let k = 0; k < segs.length - 1; k++) { // a fitted curve that is really straight loses its handles
        const A = segs[k], B = segs[k + 1], d = B.point.subtract(A.point), L = d.length;
        if (L < 1e-9) continue;
        if (Math.abs(d.cross(A.handleOut)) / L <= tol * 0.4 && Math.abs(d.cross(B.handleIn)) / L <= tol * 0.4) { A.handleOut = P(0, 0); B.handleIn = P(0, 0); }
      }
    }
    segs[0].handleIn = P(0, 0);
    segs[segs.length - 1].handleOut = P(0, 0);
    if (path.segments.length) {
      const last = path.lastSegment;
      last.handleOut = segs[0].handleOut;
      if (align.has(a)) last.data = { align: align.get(a) };
      segs.shift();
    } else if (align.has(a)) segs[0].data = { align: align.get(a) };
    path.addSegments(segs);
  }
  if (closed && path.segments.length > 1 && path.firstSegment.point.getDistance(path.lastSegment.point) < 1e-9) {
    path.firstSegment.handleIn = path.lastSegment.handleIn;
    if (path.lastSegment.data && path.lastSegment.data.align) path.firstSegment.data = path.lastSegment.data;
    path.lastSegment.remove();
  }
  for (const g of path.segments) {
    const how = g.data && g.data.align;
    if (!how || !g.previous || !g.next) continue;
    const li = g.handleIn.length, lo = g.handleOut.length;
    if (!li && !lo) continue;
    if (how === 'line') { // the curve side takes the straight side's direction
      if (g.handleIn.isZero() && !g.handleOut.isZero() && g.previous.handleOut.isZero()) g.handleOut = g.point.subtract(g.previous.point).normalize(lo);
      else if (g.handleOut.isZero() && !g.handleIn.isZero() && g.next.handleIn.isZero()) g.handleIn = g.point.subtract(g.next.point).normalize(li);
      continue;
    }
    let dir = g.handleOut.subtract(g.handleIn);
    if (!dir.length) dir = g.next.point.subtract(g.previous.point);
    if (how === 'h') dir = P(Math.sign(dir.x) || 1, 0);
    else if (how === 'v') dir = P(0, Math.sign(dir.y) || 1);
    else dir = dir.normalize();
    g.handleIn = dir.multiply(-li);
    g.handleOut = dir.multiply(lo);
  }
  return path;
}

// a run as ONE cubic when that stays within `lim` of every point (the fitter alone splits wherever the noise peaks, so
// equal shapes got different points) → [Segment, Segment] or null
function oneCurve(run, lim) {
  const f = new paper.Path({ segments: run, insert: false });
  f.simplify(1e12);
  if (f.segments.length !== 2) return null;
  for (const p of run) if (f.getNearestPoint(p).getDistance(p) > lim) return null;
  return f.segments.map((x) => new paper.Segment(x.point, x.handleIn, x.handleOut));
}

// where a fitted path is an extreme of the shape → [{ point, how }]: the path is walked in small steps; a stretch where
// the tangent lies within 4° of horizontal ('h') or vertical ('v') — or flips across it between two steps — and the
// path turns back after it (up before, down after) is one extreme, its anchor in the stretch's middle. A stretch that
// is all straight sides (a polygon's edge) is not a bend and gets no point.
function extremaOf(path, size) {
  const L = path.length, closed = path.closed;
  if (!L) return [];
  const N = Math.min(4000, Math.max(240, Math.ceil(L / (size * 0.002))));
  const sm = [];
  for (let k = 0; k < N; k++) {
    const loc = path.getLocationAt((k / N) * L);
    if (loc) sm.push({ p: loc.point, t: loc.tangent, straight: loc.curve.isStraight() });
  }
  const m = sm.length, lim = Math.sin((4 * Math.PI) / 180), out = [];
  if (m < 3) return out;
  for (const how of ['h', 'v']) {
    const lean = (i) => (how === 'h' ? sm[i].t.y : sm[i].t.x);
    const flat = sm.map((_, i) => Math.abs(lean(i)) < lim || (i + 1 < m || closed ? Math.sign(lean(i)) !== Math.sign(lean((i + 1) % m)) : false));
    if (flat.every(Boolean)) continue;
    // stretches of flat samples; a closed path starts the walk at a non-flat sample, so no stretch wraps around
    const start = closed ? flat.indexOf(false) : 0;
    for (let i = 0; i < m;) {
      if (!flat[(start + i) % m]) { i++; continue; }
      let j = i;
      while (j + 1 < m && flat[(start + j + 1) % m]) j++;
      const lo = i, hi = j;
      i = j + 1;
      const before = start + lo - 1, after = start + hi + 1;
      if (!closed && (before < 0 || after >= m)) continue; // an open path's end is not an extreme
      if (Math.sign(lean((before + m) % m)) === Math.sign(lean(after % m))) continue; // passes the axis without turning back
      let allStraight = true;
      for (let k = lo; k <= hi && allStraight; k++) if (!sm[(start + k) % m].straight) allStraight = false;
      if (allStraight) continue;
      out.push({ point: sm[(start + Math.round((lo + hi) / 2)) % m].p, how });
    }
  }
  return out;
}

// a straight stretch: within the tolerance of its chord, and not bowed — noise wanders to both sides of the chord, a
// gentle arc (the long curves of a fingerprint) keeps to one side and must stay an arc
function straight(run, tol) {
  const a = run[0], b = run[run.length - 1], d = b.subtract(a), L = d.length;
  if (L < 1e-12) return false;
  let pos = 0, neg = 0;
  for (const p of run) { const v = d.cross(p.subtract(a)) / L; if (v > pos) pos = v; if (-v > neg) neg = -v; }
  const m = Math.max(pos, neg);
  return m <= tol && (m <= tol * 0.2 || Math.min(pos, neg) >= m * 0.3);
}

// straight sides of the polyline: maximal stretches within the tolerance of a line and at least `minLen` long →
// [[a, b]] index pairs. A closed contour is read from its most bent point, so no side is cut by the start.
function straightsOf(pts, closed, tol, minLen) {
  const n = pts.length, out = [];
  let s0 = 0;
  if (closed) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      const u = pts[i].subtract(pts[(i - 2 + n) % n]), v = pts[(i + 2) % n].subtract(pts[i]);
      if (!u.length || !v.length) continue;
      const t = Math.abs(u.getDirectedAngle(v));
      if (t > best) { best = t; s0 = i; }
    }
  }
  const P_ = (k) => pts[(s0 + k) % n];
  const end = closed ? n : n - 1;
  for (let i = 0; i < end;) {
    let j = i + 1;
    const fits = (jj) => { const run = []; for (let k = i; k <= jj; k++) run.push(P_(k)); return straight(run, tol); };
    while (j + 1 <= end && fits(j + 1)) j++;
    if (P_(i).getDistance(P_(j)) >= minLen) { out.push([(s0 + i) % n, (s0 + j) % n]); i = j; } else i++;
  }
  return out;
}

// a cleaned contour (paper.Path) from its polyline. Anchors go where a designer puts them — at the corners, at both
// ends of every straight side (it becomes a true line, the curve meeting it leaves along it) and at the extremes of
// every bend (top, bottom, left, right; handles flat) — so two equal shapes get equal points wherever their files
// happened to start. Between anchors — a line or a fitted curve.
function refitJoined(pts, closed, tol, size) {
  const n = pts.length;
  if (n < (closed ? 3 : 2)) return null;
  const w = Math.max(tol * 4, size * 0.008);
  const cs = cornersOf(pts, closed, w);
  const align = new Map();
  const near = (i, j) => pts[i].getDistance(pts[j]) < w * 0.75;
  const splits = cs.slice();
  // straight sides: their ends are anchors (a corner already there stays), the curve that meets one leaves along it
  const sides = straightsOf(pts, closed, tol, Math.max(size * 0.08, w * 3));
  const inSide = new Uint8Array(n);
  for (const [a, b] of sides) {
    for (let k = (a + 1) % n; k !== b; k = (k + 1) % n) inSide[k] = 1;
    for (const e of [a, b]) {
      if (!closed && (e === 0 || e === n - 1)) continue;
      const c = splits.find((j) => near(e, j));
      if (c == null) { splits.push(e); align.set(e, 'line'); }
    }
  }
  // a first fit, only to find the extremes of the bends (the noisy polyline has a flat tangent all along a side)
  let pre = [...new Set(splits)].sort((a, b) => a - b);
  if (closed && pre.length < 2) { const a0 = pre[0] || 0; pre = [...new Set([a0, (a0 + Math.floor(n / 2)) % n])].sort((a, b) => a - b); }
  const first = fitRuns(pts, closed, pre, tol, new Map());
  for (const e of extremaOf(first, size)) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = pts[i].getDistance(e.point); if (d < bd) { bd = d; best = i; } }
    if (!closed && (best === 0 || best === n - 1)) continue;
    if (inSide[best] || splits.some((j) => near(best, j))) continue;
    splits.push(best);
    align.set(best, e.how);
  }
  splits.sort((a, b) => a - b);
  if (closed && splits.length < 2) { // no corners, sides or extremes found: two halves, as before
    const a0 = splits[0] || 0, o = (a0 + Math.floor(n / 2)) % n;
    if (!align.has(a0)) align.set(a0, 'seam');
    align.set(o, 'seam');
    return fitRuns(pts, closed, [...new Set([a0, o])].sort((a, b) => a - b), tol, align);
  }
  return fitRuns(pts, closed, [...new Set(splits)], tol, align);
}

// lines a hair off the axes go onto them (only if no point moves further than the tolerance)
function snapAxes(path, tol, size, rep) {
  const segs = path.segments, n = segs.length;
  const last = path.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = segs[i], b = segs[(i + 1) % n];
    if (!a.handleOut.isZero() || !b.handleIn.isZero()) continue;
    const d = b.point.subtract(a.point);
    if (d.length < size * 0.02) continue;
    const ang = Math.abs(((d.angle % 180) + 180) % 180);
    if (ang > 1e-6 && ang < AXIS) {
      const y = (a.point.y + b.point.y) / 2;
      if (Math.abs(a.point.y - y) <= tol * 1.5) { a.point = P(a.point.x, y); b.point = P(b.point.x, y); rep.axis++; }
    } else if (Math.abs(ang - 90) > 1e-6 && Math.abs(ang - 90) < AXIS) {
      const x = (a.point.x + b.point.x) / 2;
      if (Math.abs(a.point.x - x) <= tol * 1.5) { a.point = P(x, a.point.y); b.point = P(x, b.point.y); rep.axis++; }
    } else if (ang > 180 - AXIS && ang < 180 - 1e-6) {
      const y = (a.point.y + b.point.y) / 2;
      if (Math.abs(a.point.y - y) <= tol * 1.5) { a.point = P(a.point.x, y); b.point = P(b.point.x, y); rep.axis++; }
    }
  }
}

// the original's own points, mended where they are: hair-short segments merged, points in the middle of a straight
// line dropped, «almost smooth» joints made smooth (the handles lined up; a straight side keeps its direction)
function mendInPlace(src, closed, tol, rep) {
  const c = src.clone({ insert: false });
  c.closed = closed;
  const segs = () => c.segments;
  for (let i = 0; i < segs().length && segs().length > (closed ? 3 : 2); i++) {
    const s = segs()[i], nx = s.next || (closed ? segs()[0] : null);
    if (!nx || nx === s) continue;
    if (new paper.Curve(s, nx).length < tol) { s.handleOut = nx.handleOut; if (nx.isLast && !closed) s.point = nx.point; nx.remove(); rep.micro++; i--; }
  }
  for (let i = 0; i < segs().length && segs().length > (closed ? 3 : 2); i++) {
    const s = segs()[i], pv = s.previous, nx = s.next;
    if (!pv || !nx || !s.handleIn.isZero() || !s.handleOut.isZero() || !pv.handleOut.isZero() || !nx.handleIn.isZero()) continue;
    const a = s.point.subtract(pv.point), b = nx.point.subtract(s.point);
    if (a.length && b.length && Math.abs(a.getDirectedAngle(b)) < 1) { s.remove(); rep.collinear++; i--; }
  }
  for (const s of segs()) {
    const pv = s.previous, nx = s.next;
    if (!pv || !nx) continue;
    const inLine = s.handleIn.isZero() && pv.handleOut.isZero(), outLine = s.handleOut.isZero() && nx.handleIn.isZero();
    if (inLine && outLine) continue;
    const din = s.handleIn.isZero() ? s.point.subtract(pv.point.add(pv.handleOut)) : s.handleIn.multiply(-1);
    const dout = s.handleOut.isZero() ? nx.point.add(nx.handleIn).subtract(s.point) : s.handleOut;
    if (din.length < 1e-9 || dout.length < 1e-9) continue;
    const ang = Math.abs(din.getDirectedAngle(dout));
    if (ang <= 0.5 || ang >= KINK) continue;
    let dir;
    if (inLine) dir = s.point.subtract(pv.point).normalize();
    else if (outLine) dir = nx.point.subtract(s.point).normalize();
    else dir = din.normalize().add(dout.normalize()).normalize();
    if (!s.handleIn.isZero()) s.handleIn = dir.multiply(-s.handleIn.length);
    if (!s.handleOut.isZero()) s.handleOut = dir.multiply(s.handleOut.length);
    rep.kinks++;
  }
  return c;
}

// points that two curves don't need: a smooth point between two curves goes when ONE curve with the same end
// tangents (only its handle lengths fitted, least squares) stays within `lim` of both — so the shape and the
// smoothness at the neighbours are kept exactly. → points removed
function reducePoints(path, lim) {
  let removed = 0;
  for (let pass = 0; pass < 6; pass++) {
    let any = false;
    for (let i = 0; i < path.segments.length; i++) {
      const segs = path.segments, n = segs.length;
      if (n <= (path.closed ? 3 : 2)) return removed;
      const g = segs[i], a = g.previous, b = g.next;
      if (!a || !b || a === b) continue;
      if (a.handleOut.isZero() || b.handleIn.isZero() || g.handleIn.isZero() || g.handleOut.isZero()) continue;
      if (Math.abs(g.handleIn.multiply(-1).getDirectedAngle(g.handleOut)) > 3) continue; // a corner stays
      const c1 = new paper.Curve(a, g), c2 = new paper.Curve(g, b);
      const L1 = c1.length, L2 = c2.length, L = L1 + L2;
      if (L < 1e-9) continue;
      const Q = [], T = [];
      for (let k = 1; k < 16; k++) { const f = k / 16; Q.push(c1.getPointAt(f * L1)); T.push((f * L1) / L); }
      for (let k = 0; k < 16; k++) { const f = k / 16; Q.push(c2.getPointAt(f * L2)); T.push((L1 + f * L2) / L); }
      const P0 = a.point, P3 = b.point, t0 = a.handleOut.normalize(), t3 = b.handleIn.normalize();
      // B(t) = base(t) + A(t)·x·t0 + Bt(t)·y·t3 — linear in the two handle lengths x, y
      let m11 = 0, m12 = 0, m22 = 0, r1 = 0, r2 = 0;
      for (let k = 0; k < Q.length; k++) {
        const t = T[k], u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
        const base = P0.multiply(b0 + b1).add(P3.multiply(b2 + b3));
        const A = t0.multiply(b1), B = t3.multiply(b2), R = Q[k].subtract(base);
        m11 += A.dot(A); m12 += A.dot(B); m22 += B.dot(B); r1 += A.dot(R); r2 += B.dot(R);
      }
      const det = m11 * m22 - m12 * m12;
      if (Math.abs(det) < 1e-12) continue;
      const x = (r1 * m22 - r2 * m12) / det, y = (m11 * r2 - m12 * r1) / det;
      if (!(x > 0 && y > 0) || x > L || y > L) continue;
      const test = new paper.Path({ segments: [new paper.Segment(P0, null, t0.multiply(x)), new paper.Segment(P3, t3.multiply(y), null)], insert: false });
      let worst = 0;
      for (const q of Q) { worst = Math.max(worst, test.getNearestPoint(q).getDistance(q)); if (worst > lim) break; }
      if (worst > lim) continue;
      a.handleOut = t0.multiply(x);
      b.handleIn = t3.multiply(y);
      g.remove();
      removed++; any = true; i--;
    }
    if (!any) break;
  }
  return removed;
}

// how far the original's polyline gets from a path (sampled: up to ~600 points)
function farthest(path, pts) {
  const step = Math.max(1, Math.floor(pts.length / 600));
  let m = 0;
  for (let i = 0; i < pts.length; i += step) m = Math.max(m, path.getNearestPoint(pts[i]).getDistance(pts[i]));
  return m;
}

// one contour of the file → its clean version: drawn again from its polyline when that needs fewer points (noise,
// points in odd places), else mended on its own points
function cleanContour(src, closed, tol, size, rep) {
  const pts = polyOf(src, tol);
  const loops = untangle(pts, closed, size * 0.03);
  if (pts.length < (closed ? 3 : 2)) { rep.junk++; return null; }
  const fit = refitJoined(pts, closed, tol, size);
  const mine = { micro: 0, kinks: 0, collinear: 0 };
  const mended = mendInPlace(src, closed, tol, mine);
  let out;
  // the redraw has to keep the shape: no point of the original further from it than the tolerance
  if (fit && (loops || fit.segments.length < mended.segments.length) && farthest(fit, pts) <= tol * 1.1) { out = fit; rep.refit++; rep.crossings += loops; rep.micro += Math.max(0, src.segments.length - fit.segments.length); }
  else { out = mended; rep.micro += mine.micro; rep.kinks += mine.kinks; rep.collinear += mine.collinear; }
  rep.micro += reducePoints(out, tol * 0.5);
  snapAxes(out, tol, size, rep);
  return out;
}

// path data in absolute coordinates: paper writes relative ones, and their rounding piles up along a contour — its end
// missed its start by a rounding step and came back as a doubled point
function dOf(item, prec) {
  const f = (v) => { const r = +v.toFixed(prec); return Object.is(r, -0) ? '0' : String(r); };
  const pt = (q) => f(q.x) + ' ' + f(q.y);
  let d = '';
  for (const k of item.className === 'CompoundPath' ? item.children : [item]) {
    const sg = k.segments, n = sg.length;
    if (!n) continue;
    d += 'M' + pt(sg[0].point);
    const last = k.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = sg[i], b = sg[(i + 1) % n], end = i === n - 1;
      if (a.handleOut.isZero() && b.handleIn.isZero()) {
        if (end) break; // the closing line is the «Z» itself
        const sx = f(a.point.x) === f(b.point.x), sy = f(a.point.y) === f(b.point.y);
        d += sx && !sy ? 'V' + f(b.point.y) : sy && !sx ? 'H' + f(b.point.x) : 'L' + pt(b.point);
      } else d += 'C' + pt(a.point.add(a.handleOut)) + ' ' + pt(b.point.add(b.handleIn)) + ' ' + pt(b.point);
    }
    if (k.closed) d += 'Z';
  }
  return d;
}

const absArea = (it) => Math.abs(it.area);
function unite(a, b) { return a ? a.unite(b, { insert: false }) : b; }

// the item's children as plain paths, crumbs dropped
function dropCrumbs(item, minA, rep) {
  if (!item) return null;
  const kids = item.className === 'CompoundPath' ? item.children.slice() : [item];
  const keep = kids.filter((k) => {
    const b = k.bounds;
    const ok = absArea(k) >= minA * minA && Math.max(b.width, b.height) >= minA;
    if (!ok) rep.junk++;
    return ok;
  });
  if (!keep.length) return null;
  if (keep.length === kids.length) return item;
  return keep.length === 1 ? keep[0].clone({ insert: false }) : new paper.CompoundPath({ children: keep.map((k) => k.clone({ insert: false })), insert: false });
}

export function fixSvg(text, opt = {}) {
  setup();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('это не SVG');
  // SVG paints black when nobody says otherwise; paper leaves such shapes without a fill
  const st = root.getAttribute('style') || '';
  if (!root.hasAttribute('fill') && !/(^|;)\s*fill\s*:/.test(st)) root.setAttribute('fill', '#000000');
  let item;
  try { item = paper.project.importSVG(root, { insert: false, expandShapes: true }); } catch (e) { throw new Error('SVG не прочитался'); }
  let frame = frameOf(root);
  const box0 = item.bounds;
  if (!frame) frame = { x: box0.x, y: box0.y, w: box0.width, h: box0.height, vb: false };
  const size = Math.max(frame.w, frame.h) || 1;
  const tol = size * (opt.tol || STRENGTH[opt.strength] || STRENGTH.normal);
  const rep = { before: 0, after: 0, micro: 0, kinks: 0, collinear: 0, refit: 0, axis: 0, crossings: 0, overlaps: 0, junk: 0, closed: 0, strokes: 0, colors: 0 };
  const groups = new Map(); // colour → { fill, alpha, parts: [paper items] }
  const before = [];
  const ptsBefore = [];
  const add = (fill, alpha, it) => {
    const key = fill + '|' + alpha.toFixed(3);
    if (!groups.has(key)) groups.set(key, { fill, alpha, parts: [] });
    groups.get(key).parts.push(it);
  };
  const all = item.getItems({ class: paper.Path }).concat(item.getItems({ class: paper.CompoundPath }));
  for (const p of all) {
    if (p.parent && p.parent.className === 'CompoundPath') continue;
    if (p.clipMask || (p.parent && p.parent.clipped && p.parent.firstChild === p)) continue;
    const op = (() => { let o = 1; for (let q = p; q; q = q.parent) o *= q.opacity == null ? 1 : q.opacity; return o; })();
    const filled = visible(p.fillColor, op);
    const stroked = visible(p.strokeColor, op) && p.strokeWidth > 0;
    if (!filled && !stroked) continue;
    const m = p.globalMatrix || new paper.Matrix();
    const kids = p.className === 'CompoundPath' ? p.children : [p];
    const cleaned = [], lines = [];
    for (const q of kids) {
      if (!q.segments.length) continue;
      const c = q.clone({ insert: false });
      c.transform(m);
      rep.before += c.segments.length;
      before.push(c.pathData);
      c.segments.forEach((s) => ptsBefore.push([s.point.x, s.point.y]));
      const near = c.segments.length > 2 && c.firstSegment.point.getDistance(c.lastSegment.point) < tol;
      const shut = c.closed || near;
      if (filled) {
        if (!c.closed && !near && c.segments.length > 2) rep.closed++;
        if (near && !c.closed) { c.lastSegment.remove(); }
        const cc = cleanContour(c, true, tol, size, rep);
        if (cc) cleaned.push(cc);
      }
      if (stroked) {
        if (near && !c.closed) c.lastSegment.remove();
        const cc = cleanContour(c, shut, tol, size, rep);
        if (cc) lines.push({ path: cc, closed: shut });
      }
    }
    if (filled && cleaned.length) {
      let cp = cleaned.length === 1 ? cleaned[0] : new paper.CompoundPath({ children: cleaned, insert: false });
      cp.fillRule = p.fillRule || 'nonzero';
      const cr = cp.getCrossings ? cp.getCrossings().length : 0;
      if (cr) rep.crossings += Math.ceil(cr / 2) || 1;
      cp = cp.resolveCrossings();
      cp = cp.reorient(cp.fillRule !== 'evenodd', true);
      add(hexOf(p.fillColor), p.fillColor.alpha * op, cp);
    }
    if (stroked && lines.length) {
      const sw = p.strokeWidth * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      for (const l of lines) {
        const o = strokeShape(l.path, sw, { cap: p.strokeCap, join: p.strokeJoin, closed: l.closed, miter: p.miterLimit || 4, size });
        if (!o) continue;
        // the outline comes from a dense polygon: fitted again with this file's tolerance, it keeps few points
        const ks = (o.className === 'CompoundPath' ? o.children : [o]).map((k) => cleanContour(k, true, tol, size, { micro: 0, kinks: 0, collinear: 0, refit: 0, axis: 0, junk: 0 })).filter(Boolean);
        if (!ks.length) continue;
        let oc = ks.length === 1 ? ks[0] : new paper.CompoundPath({ children: ks, insert: false });
        oc = oc.reorient(true, true);
        add(hexOf(p.strokeColor), p.strokeColor.alpha * op, oc);
        rep.strokes++;
      }
    }
  }
  item.remove();
  // one clean outline per colour: overlapping shapes merge (counted when the merged area is smaller than the sum)
  const minA = size * JUNK;
  const after = [];
  for (const g of groups.values()) {
    let acc = null;
    for (const part of g.parts) {
      const sum = (acc ? absArea(acc) : 0) + absArea(part);
      const u = unite(acc, part);
      if (acc && sum - absArea(u) > tol * tol * 4) rep.overlaps++;
      acc = u;
    }
    acc = dropCrumbs(acc, minA, rep);
    if (!acc) continue;
    // the booleans and the fitter can leave two points a hair apart (two corners found on one bend, a seam on an
    // intersection): merged, or a bevel downstream has nowhere to go
    const tidy = { micro: 0, kinks: 0, collinear: 0 };
    const kids = (acc.className === 'CompoundPath' ? acc.children : [acc]).map((k) => mendInPlace(k, true, tol, tidy));
    acc = kids.length === 1 ? kids[0] : new paper.CompoundPath({ children: kids, insert: false });
    after.push({ item: acc, fill: g.fill, alpha: g.alpha });
  }
  rep.colors = after.length;
  if (!after.length) throw new Error('в SVG не осталось фигур');
  const prec = Math.max(0, Math.min(4, Math.ceil(Math.log10(5000 / size))));
  const ptsAfter = [];
  const paths = after.map((a) => {
    rep.after += segCount(a.item);
    const kids = a.item.className === 'CompoundPath' ? a.item.children : [a.item];
    kids.forEach((k) => k.segments.forEach((s) => ptsAfter.push([s.point.x, s.point.y])));
    return { d: dOf(a.item, prec), fill: a.fill, alpha: a.alpha };
  });
  const num = (v) => +v.toFixed(prec);
  const attrs = [`xmlns="http://www.w3.org/2000/svg"`];
  const W = root.getAttribute('width'), H = root.getAttribute('height');
  if (W && H) attrs.push(`width="${W.replace(/"/g, '')}"`, `height="${H.replace(/"/g, '')}"`);
  attrs.push(`viewBox="${num(frame.x)} ${num(frame.y)} ${num(frame.w)} ${num(frame.h)}"`);
  const body = paths.map((p) => `<path d="${p.d}" fill="${p.fill}"${p.alpha < 0.999 ? ` fill-opacity="${+p.alpha.toFixed(3)}"` : ''}/>`).join('\n');
  const svg = `<svg ${attrs.join(' ')}>\n${body}\n</svg>\n`;
  rep.changed = rep.refit + rep.micro + rep.kinks + rep.collinear + rep.axis + rep.crossings + rep.overlaps + rep.junk + rep.closed + rep.strokes > 0 || rep.after < rep.before;
  return { svg, report: rep, preview: { frame, before, after: paths, ptsBefore, ptsAfter } };
}

// the report as short lines for people («Точек 412 → 58», «Склеено наложений: 2»…)
// for the checks in the browser console
export const _internals = { refitJoined, cornersOf, extremaOf, straightsOf, polyOf, fitRuns };

export function reportLines(r) {
  const out = [];
  if (r.before !== r.after) out.push(`Точек ${r.before} → ${r.after}`);
  if (r.refit) out.push(`Точки расставлены заново, по форме: ${r.refit} ${r.refit === 1 ? 'контур' : r.refit < 5 ? 'контура' : 'контуров'}`);
  if (r.micro) out.push(`Убрано лишних и сдвоенных точек: ${r.micro}`);
  if (r.kinks) out.push(`Сглажено изломов: ${r.kinks}`);
  if (r.collinear) out.push(`Убрано точек посреди прямых: ${r.collinear}`);
  if (r.axis) out.push(`Выровнено почти прямых линий: ${r.axis}`);
  if (r.crossings) out.push(`Распутано самопересечений: ${r.crossings}`);
  if (r.overlaps) out.push(`Склеено наложений: ${r.overlaps}`);
  if (r.strokes) out.push(`Обводки → контуры: ${r.strokes}`);
  if (r.closed) out.push(`Замкнуто открытых контуров: ${r.closed}`);
  if (r.junk) out.push(`Убран мелкий мусор: ${r.junk}`);
  return out;
}
