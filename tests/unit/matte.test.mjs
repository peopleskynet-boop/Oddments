// The cut-out edge (src/lib/matte.js): box mean, resampling, and that the guided edge follows the photo
import test from 'node:test';
import assert from 'node:assert/strict';
import { boxMean, resample, matte } from '../../src/lib/matte.js';

test('box mean: a constant stays, a step is averaged over the window cut at the edges', () => {
  const W = 5, H = 1, a = new Float32Array([0, 0, 1, 1, 1]);
  const m = boxMean(a, W, H, 1);
  assert.deepEqual(Array.from(m).map((v) => +v.toFixed(3)), [0, 0.333, 0.667, 1, 1]);
  const c = boxMean(new Float32Array(12).fill(0.5), 4, 3, 2);
  assert.ok(c.every((v) => Math.abs(v - 0.5) < 1e-6));
});

test('resample keeps a constant and the order of a gradient', () => {
  const g = resample(new Float32Array([0, 1, 2, 3]), 2, 2, 4, 4);
  assert.equal(g.length, 16);
  assert.ok(g[0] <= g[3] && g[0] <= g[12] && g[15] >= g[12]);
  assert.ok(resample(new Float32Array(4).fill(0.7), 2, 2, 7, 5).every((v) => Math.abs(v - 0.7) < 1e-6));
});

test('matte: a coarse mask snaps to the sharp edge of the picture, and the old background leaves the edge colour', () => {
  // 64 × 64: a white square (x 20..43) on a red background; the network's mask is coarse (8 × 8) and blurry
  const W = 64, H = 64, px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, inside = x >= 20 && x < 44 && y >= 20 && y < 44;
    // column 19 is the anti-aliased edge: half white, half red → pink
    const mix = x === 19 && y >= 20 && y < 44;
    px[o] = 255; px[o + 1] = inside ? 255 : mix ? 128 : 0; px[o + 2] = inside ? 255 : mix ? 128 : 0; px[o + 3] = 255;
  }
  // the network's mask at a quarter of the size, soft by one of its pixels (≈ ±2 px here) — as a 1024 mask over a photo
  const low = new Float32Array(256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) low[y * 16 + x] = x >= 5 && x < 11 && y >= 5 && y < 11 ? 1 : x >= 4 && x < 12 && y >= 4 && y < 12 ? 0.5 : 0;
  const out = matte(px, W, H, low, 16, 16, { work: 64 });
  const a = (x, y) => out[(y * W + x) * 4 + 3] / 255;
  const p = resample(low, 16, 16, W, H), m = (x, y) => p[y * W + x];
  assert.ok(a(32, 32) > 0.95, 'inside stays');
  assert.ok(a(5, 5) < 0.05, 'far outside goes');
  // the edge moves toward the picture's own: more opaque just inside it, more transparent just outside than the
  // network's soft mask (a fit, not a hard snap — soft hair must stay soft)
  assert.ok(a(20, 32) > m(20, 32) + 0.05 && a(20, 32) > 0.85, `inner edge ${a(20, 32)} vs mask ${m(20, 32)}`);
  assert.ok(a(18, 32) < m(18, 32) - 0.05, `outer edge ${a(18, 32)} vs mask ${m(18, 32)}`);
  assert.ok(a(20, 32) - a(18, 32) > 0.5, 'the edge is steep where the picture\'s is (the mask rose 0,25 over these 2 px)');
  // the pink edge pixel is half the object: it keeps part of the opacity, and its colour loses the red background
  const o = (32 * W + 19) * 4;
  assert.ok(out[o + 3] > 25 && out[o + 3] < 230, 'the mixed pixel is half transparent: ' + out[o + 3]);
  assert.ok(out[o + 1] > 180, 'the red is taken off its colour, green ' + out[o + 1] + ' (was 128)');
});
