// The upscale worker: Real-ESRGAN x4plus (Xintao Wang et al., BSD-3) makes a picture 4× larger and draws the detail a
// plain resize blurs. The picture goes through in tiles, so a big one never needs the whole network's memory at once;
// each tile is cut with a margin and only its middle is kept, so the seams do not show. WebGPU when the machine has it
// (and float16 shaders), WebAssembly otherwise — the same file, the same result, minutes instead of seconds.
import * as ort from 'onnxruntime-web';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

const PAD = 12; // the margin each tile is cut with, in source pixels (the network sees ~10 px around a pixel)
let sess = null, device = 'wasm', gpuWhy = '';

async function init({ url, gpu }) {
  if (sess) return { device, gpuWhy };
  let last;
  for (const ep of gpu && 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm']) {
    // On the graphics card NCHW and only basic graph fusion: with the default NHWC the last convolution of this float16
    // model fails («Failed to generate kernel's output»), and the full optimisation makes FusedConv, which WebGPU has
    // only for float32. Measured: a 216 px tile in ~0.3 s, a 280 px one in ~0.5 s.
    const prov = ep === 'webgpu' ? { name: 'webgpu', preferredLayout: 'NCHW' } : ep;
    try { sess = await ort.InferenceSession.create(url, { executionProviders: [prov], graphOptimizationLevel: ep === 'webgpu' ? 'basic' : 'all' }); device = ep; return { device, gpuWhy }; } catch (e) { last = e; if (ep === 'webgpu') gpuWhy = (e && e.message) || String(e); }
  }
  throw last;
}

// float32 ⇄ float16 bits (the model's input and output are float16)
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return e < -10 ? s : s | ((m | 0x800000) >> (1 - e + 13));
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >> 13);
}
const HALF = new Float32Array(65536);
for (let h = 0; h < 65536; h++) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  HALF[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
}
const BYTE = new Uint16Array(256).map((_, i) => toHalf(i / 255));

// Under transparent pixels the colour is black, and the network would draw a dark rim along the edge: the colour of the
// opaque neighbours is spread outwards a few pixels first (the alpha is put back at the end, so this never shows)
function bleed(px, W, H, passes = 12) {
  let known = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) known[i] = px[i * 4 + 3] > 0 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = known.slice();
    let grew = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (known[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, j = yy * W + xx;
            if (xx < 0 || xx >= W || !known[j]) continue;
            r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; n++;
          }
        }
        if (n) { px[i * 4] = r / n; px[i * 4 + 1] = g / n; px[i * 4 + 2] = b / n; next[i] = 1; grew = true; }
      }
    }
    known = next;
    if (!grew) break;
  }
}

async function run({ bitmap, scale, tile }) {
  const W = bitmap.width, H = bitmap.height;
  const src = new OffscreenCanvas(W, H), sg = src.getContext('2d', { willReadFrequently: true });
  sg.drawImage(bitmap, 0, 0);
  const px = sg.getImageData(0, 0, W, H).data;
  let alpha = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break; }
  if (alpha) bleed(px, W, H);
  const out = new OffscreenCanvas(W * scale, H * scale), og = out.getContext('2d');
  og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
  const cols = Math.ceil(W / tile), rows = Math.ceil(H / tile), total = cols * rows;
  let done = 0;
  const t0 = performance.now();
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      // the tile's own part and the part cut for the network (with the margin, inside the picture)
      const x0 = tx * tile, y0 = ty * tile, x1 = Math.min(W, x0 + tile), y1 = Math.min(H, y0 + tile);
      const cx0 = Math.max(0, x0 - PAD), cy0 = Math.max(0, y0 - PAD), cx1 = Math.min(W, x1 + PAD), cy1 = Math.min(H, y1 + PAD);
      const w = cx1 - cx0, h = cy1 - cy0, n = w * h;
      const inp = new Uint16Array(3 * n);
      for (let y = 0; y < h; y++) {
        let o = ((cy0 + y) * W + cx0) * 4, j = y * w;
        for (let x = 0; x < w; x++, o += 4, j++) { inp[j] = BYTE[px[o]]; inp[n + j] = BYTE[px[o + 1]]; inp[2 * n + j] = BYTE[px[o + 2]]; }
      }
      const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float16', inp, [1, 3, h, w]) });
      const y16 = res[sess.outputNames[0]];
      const data = y16.data, isHalf = data instanceof Uint16Array;
      // the middle, 4× larger, as pixels
      const ow = (x1 - x0) * 4, oh = (y1 - y0) * 4, OW = w * 4, ON = OW * h * 4, ox = (x0 - cx0) * 4, oy = (y0 - cy0) * 4;
      const img = new ImageData(ow, oh), d = img.data;
      for (let y = 0; y < oh; y++) {
        let j = (oy + y) * OW + ox, o = y * ow * 4;
        for (let x = 0; x < ow; x++, j++, o += 4) {
          for (let c = 0; c < 3; c++) {
            const v = isHalf ? HALF[data[c * ON + j]] : data[c * ON + j];
            d[o + c] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
          }
          d[o + 3] = 255;
        }
      }
      y16.dispose && y16.dispose();
      if (scale === 4) og.putImageData(img, x0 * 4, y0 * 4);
      else {
        const t = new OffscreenCanvas(ow, oh);
        t.getContext('2d').putImageData(img, 0, 0);
        og.drawImage(t, x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
      }
      done++;
      const ms = performance.now() - t0;
      self.postMessage({ type: 'progress', done, total, left: Math.round(ms / done * (total - done)) });
    }
  }
  // transparency: the original's alpha, enlarged smoothly (the network sees colour only)
  if (alpha) { og.globalCompositeOperation = 'destination-in'; og.drawImage(bitmap, 0, 0, W * scale, H * scale); }
  bitmap.close();
  const blob = await out.convertToBlob({ type: 'image/png' });
  return { blob, w: W * scale, h: H * scale, device };
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') self.postMessage({ rid: m.rid, ...(await init(m)) });
    else if (m.type === 'run') self.postMessage({ rid: m.rid, ...(await run(m)) });
  } catch (e) {
    self.postMessage({ rid: m.rid, type: 'error', error: (e && e.message) || String(e) });
  }
};
