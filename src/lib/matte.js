// The edge of a cut-out (cutout.worker.js), past what the network gives. The network sees the picture at 1024 × 1024, so
// its mask is soft and a little off on a big photo; two steps make the edge the photo's own:
//  1. fast guided filter (He & Sun, 2015) with a colour guide: at a working size (≤ WORK px on the long side) the mask is
//     fitted, window by window, as a linear function of the picture's colour; those coefficients are then stretched to
//     the full size and applied to the full-size colours — the edge follows real pixels (hair, fur, thin lines) at full
//     resolution, and the heavy part never runs on the full picture.
//  2. colour decontamination: on half-transparent edge pixels the old background shows through (a light rim on a dark
//     backdrop). The local background colour is estimated from nearby background pixels, and the foreground colour is
//     solved from I = α·F + (1 − α)·B. Where α is tiny the solve is noisy, so it fades to a blur of nearby foreground.
// Pure functions on typed arrays: no DOM, testable in Node.

export const WORK = 1600;

// mean over a (2r+1)² window with the window cut at the edges; two passes of running sums
export function boxMean(src, W, H, r, out = new Float32Array(W * H), tmp = new Float32Array(W * H)) {
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let s = 0;
    for (let x = 0; x <= Math.min(r, W - 1); x++) s += src[row + x];
    for (let x = 0; x < W; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(W - 1, x + r);
      tmp[row + x] = s / (hi - lo + 1);
      if (x + r + 1 < W) s += src[row + x + r + 1];
      if (x - r >= 0) s -= src[row + x - r];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(r, H - 1); y++) s += tmp[y * W + x];
    for (let y = 0; y < H; y++) {
      const lo = Math.max(0, y - r), hi = Math.min(H - 1, y + r);
      out[y * W + x] = s / (hi - lo + 1);
      if (y + r + 1 < H) s += tmp[(y + r + 1) * W + x];
      if (y - r >= 0) s -= tmp[(y - r) * W + x];
    }
  }
  return out;
}

// bilinear resample of one channel (pixel centres aligned)
export function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh), kx = sw / dw, ky = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * ky - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * kx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * dw + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

// The colour guided filter at the working size. rgb: Float32Array × 3 (0..1), p: the mask. Returns the smoothed
// coefficients { ar, ag, ab, b }: q = ar·R + ag·G + ab·B + b, and `conf` — how well colour explains the mask in each
// window (the share of the mask's variance the linear fit explains). Where it does not (silver spokes over beige wood
// planks: the background has the object's colours), the guided result drew ghost stripes; there the network's own mask
// is kept.
export function guidedCoeffs(R, G, B, p, W, H, r, eps) {
  const n = W * H, tmp = new Float32Array(n), box = (a) => boxMean(a, W, H, r, new Float32Array(n), tmp);
  const prod = (a, b) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a[i] * b[i]; return o; };
  const mR = box(R), mG = box(G), mB = box(B), mP = box(p), vPP = box(prod(p, p));
  const vRR = box(prod(R, R)), vRG = box(prod(R, G)), vRB = box(prod(R, B)), vGG = box(prod(G, G)), vGB = box(prod(G, B)), vBB = box(prod(B, B));
  const cR = box(prod(R, p)), cG = box(prod(G, p)), cB = box(prod(B, p));
  const ar = new Float32Array(n), ag = new Float32Array(n), ab = new Float32Array(n), b = new Float32Array(n), conf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const mr = mR[i], mg = mG[i], mb = mB[i], mp = mP[i];
    // covariance of the colour (3 × 3, symmetric) + eps, and of colour with the mask
    const s11 = vRR[i] - mr * mr + eps, s12 = vRG[i] - mr * mg, s13 = vRB[i] - mr * mb;
    const s22 = vGG[i] - mg * mg + eps, s23 = vGB[i] - mg * mb, s33 = vBB[i] - mb * mb + eps;
    const q1 = cR[i] - mr * mp, q2 = cG[i] - mg * mp, q3 = cB[i] - mb * mp;
    // Σ⁻¹ by cofactors
    const c11 = s22 * s33 - s23 * s23, c12 = s13 * s23 - s12 * s33, c13 = s12 * s23 - s13 * s22;
    const c22 = s11 * s33 - s13 * s13, c23 = s13 * s12 - s11 * s23, c33 = s11 * s22 - s12 * s12;
    const det = s11 * c11 + s12 * c12 + s13 * c13 || 1e-12;
    const a1 = (c11 * q1 + c12 * q2 + c13 * q3) / det, a2 = (c12 * q1 + c22 * q2 + c23 * q3) / det, a3 = (c13 * q1 + c23 * q2 + c33 * q3) / det;
    ar[i] = a1; ag[i] = a2; ab[i] = a3; b[i] = mp - a1 * mr - a2 * mg - a3 * mb;
    const vp = vPP[i] - mp * mp;
    // explained share; a window with (almost) no edge in it trusts the fit — there it changes nothing anyway
    conf[i] = vp < 1e-4 ? 1 : Math.min(1, Math.max(0, ((a1 * q1 + a2 * q2 + a3 * q3) / vp - 0.35) / 0.4));
  }
  return { ar: box(ar), ag: box(ag), ab: box(ab), b: box(b), conf: box(conf) };
}

// where the edge is: the mask neither clearly in nor clearly out, widened by `grow` and softened — the guided result is
// used only there, the inside of an object keeps the network's mask (a textured sweater must not get holes)
export function edgeBand(p, W, H, grow) {
  const n = W * H, edge = new Float32Array(n);
  for (let i = 0; i < n; i++) edge[i] = p[i] > 0.02 && p[i] < 0.98 ? 1 : 0;
  // also the step between in and out (a hard network edge has no half values at all)
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) { const i = y * W + x; if ((p[i] > 0.5) !== (p[i - 1] > 0.5)) { edge[i] = 1; edge[i - 1] = 1; } }
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if ((p[i] > 0.5) !== (p[i - W] > 0.5)) { edge[i] = 1; edge[i - W] = 1; } }
  const wide = boxMean(edge, W, H, grow);
  for (let i = 0; i < n; i++) wide[i] = wide[i] > 0 ? 1 : 0;
  return boxMean(wide, W, H, Math.max(1, grow >> 1));
}

// local background and foreground colours (normalized convolution), for the decontamination
export function layerColours(R, G, B, p, W, H, r) {
  const n = W * H, tmp = new Float32Array(n);
  const est = (weight) => {
    const w = new Float32Array(n), cr = new Float32Array(n), cg = new Float32Array(n), cb = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = weight(p[i]); w[i] = k; cr[i] = k * R[i]; cg[i] = k * G[i]; cb[i] = k * B[i]; }
    // two box passes ≈ a tent: smoother than one
    const sm = (a) => boxMean(boxMean(a, W, H, r, new Float32Array(n), tmp), W, H, r, new Float32Array(n), tmp);
    const sw = sm(w), sr = sm(cr), sg = sm(cg), sb = sm(cb);
    for (let i = 0; i < n; i++) { const d = sw[i] > 1e-4 ? sw[i] : 0; sr[i] = d ? sr[i] / d : R[i]; sg[i] = d ? sg[i] / d : G[i]; sb[i] = d ? sb[i] / d : B[i]; }
    return [sr, sg, sb];
  };
  // background: only where the mask is near zero; foreground: where it is near one
  return { bg: est((a) => (a < 0.15 ? (1 - a) * (1 - a) : 0)), fg: est((a) => (a > 0.85 ? a * a : 0)) };
}

// The whole edge at full size. px: RGBA of the picture (W × H); low: the network's mask (lw × lh). Returns the
// cut-out RGBA. opts: { work, eps, decon (default true) }.
export function matte(px, W, H, low, lw, lh, opts = {}) {
  const long = Math.max(W, H), s = Math.min(1, (opts.work || WORK) / long);
  const ww = Math.max(1, Math.round(W * s)), wh = Math.max(1, Math.round(H * s)), n = ww * wh;
  // the picture at the working size (area average), colours 0..1, and its own alpha (a PNG may already be cut)
  const R = new Float32Array(n), G = new Float32Array(n), Bc = new Float32Array(n), A0 = new Float32Array(n);
  {
    const kx = W / ww, ky = H / wh;
    for (let y = 0; y < wh; y++) {
      const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
      for (let x = 0; x < ww; x++) {
        const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx));
        let r = 0, g = 0, b = 0, a = 0, c = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const o = (yy * W + xx) * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; a += px[o + 3]; c++; }
        const i = y * ww + x;
        R[i] = r / c / 255; G[i] = g / c / 255; Bc[i] = b / c / 255; A0[i] = a / c / 255;
      }
    }
  }
  const p = resample(low, lw, lh, ww, wh);
  for (let i = 0; i < n; i++) p[i] = Math.min(1, Math.max(0, p[i])) * A0[i];
  // the window must reach the real edge from where the coarse mask put it: at least 1.5 of the mask's own pixels
  const r = Math.max(3, Math.round(long * s / 400), Math.ceil(1.5 * Math.max(ww, wh) / Math.max(lw, lh))), eps = opts.eps || 1e-4;
  const co = guidedCoeffs(R, G, Bc, p, ww, wh, r, eps);
  const band = edgeBand(p, ww, wh, r * 2);
  const decon = opts.decon !== false;
  const lc = decon ? layerColours(R, G, Bc, p, ww, wh, Math.max(4, Math.round(long * s / 60))) : null;

  // full size: every work-size field is sampled bilinearly; outside the edge band only the mask is needed
  const out = new Uint8ClampedArray(W * H * 4), kx = ww / W, ky = wh / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(wh - 1, Math.max(0, (y + 0.5) * ky - 0.5)), y0 = Math.floor(fy), y1 = Math.min(wh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(ww - 1, Math.max(0, (x + 0.5) * kx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(ww - 1, x0 + 1), tx = fx - x0;
      const i00 = y0 * ww + x0, i01 = y0 * ww + x1, i10 = y1 * ww + x0, i11 = y1 * ww + x1;
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      const at = (a) => a[i00] * w00 + a[i01] * w01 + a[i10] * w10 + a[i11] * w11;
      const o = (y * W + x) * 4, ir = px[o] / 255, ig = px[o + 1] / 255, ib = px[o + 2] / 255, ia = px[o + 3] / 255;
      let alpha = at(p);
      const bw = at(band) * at(co.conf);
      if (bw > 0.001) {
        const q = at(co.ar) * ir + at(co.ag) * ig + at(co.ab) * ib + at(co.b);
        alpha = bw * Math.min(1, Math.max(0, q)) + (1 - bw) * alpha;
      }
      alpha = Math.min(alpha, ia);
      let fr = ir, fg = ig, fb = ib;
      if (lc && bw > 0.001 && alpha > 0.002 && alpha < 0.998) {
        const br = at(lc.bg[0]), bg = at(lc.bg[1]), bb = at(lc.bg[2]);
        const sr = (ir - (1 - alpha) * br) / alpha, sg = (ig - (1 - alpha) * bg) / alpha, sb = (ib - (1 - alpha) * bb) / alpha;
        const t = Math.min(1, Math.max(0, (alpha - 0.05) / 0.3));
        const er = at(lc.fg[0]), eg = at(lc.fg[1]), eb = at(lc.fg[2]);
        fr = er + (Math.min(1, Math.max(0, sr)) - er) * t; fg = eg + (Math.min(1, Math.max(0, sg)) - eg) * t; fb = eb + (Math.min(1, Math.max(0, sb)) - eb) * t;
        // only the edge's colour changes: a solid part of the object keeps its own pixels
        const k = bw * (1 - Math.max(0, (alpha - 0.9) / 0.098));
        fr = ir + (fr - ir) * k; fg = ig + (fg - ig) * k; fb = ib + (fb - ib) * k;
      }
      out[o] = fr * 255; out[o + 1] = fg * 255; out[o + 2] = fb * 255; out[o + 3] = alpha * 255;
    }
  }
  return out;
}
