// The background-removal worker: BEN2 (Prama, MIT) finds the object at 1024 × 1024 on the graphics card, matte.js
// fits the edge to the full-size photo and takes the old background's colour off it. Only WebGPU: on WebAssembly the
// model runs out of memory (std::bad_alloc).
import * as ort from 'onnxruntime-web';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import { matte } from './matte.js';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;

const S = 1024; // the model's input size
let sess = null;

async function init({ url }) {
  if (!sess) sess = await ort.InferenceSession.create(url, { executionProviders: [{ name: 'webgpu' }], graphOptimizationLevel: 'all' });
  return { device: 'webgpu' };
}

// float16 bits → number, for a browser without Float16Array (the output then comes as Uint16Array)
const HALF = new Float32Array(65536);
for (let h = 0; h < 65536; h++) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  HALF[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
}

async function run({ bitmap }) {
  const t0 = performance.now(), W = bitmap.width, H = bitmap.height;
  self.postMessage({ type: 'progress', phase: 'model' });
  // the model sees the whole picture squeezed to 1024 × 1024, colours 0..1 (no mean/std: BEN2 normalizes inside)
  const small = new OffscreenCanvas(S, S), sx = small.getContext('2d', { willReadFrequently: true });
  sx.imageSmoothingQuality = 'high';
  sx.fillStyle = '#fff'; sx.fillRect(0, 0, S, S); // a transparent PNG: what is see-through counts as background anyway
  sx.drawImage(bitmap, 0, 0, S, S);
  const sp = sx.getImageData(0, 0, S, S).data, n = S * S, inp = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { inp[i] = sp[i * 4] / 255; inp[n + i] = sp[i * 4 + 1] / 255; inp[2 * n + i] = sp[i * 4 + 2] / 255; }
  const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, S, S]) });
  const o = res[sess.outputNames[sess.outputNames.length - 1]], d = o.data;
  // float16 output: Float16Array (numbers) where the browser has it, otherwise the raw bits in a Uint16Array
  const low = d instanceof Uint16Array ? Float32Array.from(d, (h) => HALF[h]) : Float32Array.from(d);
  if (o.dispose) o.dispose();
  self.postMessage({ type: 'progress', phase: 'edge' });
  const full = new OffscreenCanvas(W, H), fx = full.getContext('2d', { willReadFrequently: true });
  fx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const px = fx.getImageData(0, 0, W, H).data;
  const rgba = matte(px, W, H, low, S, S);
  return { rgba: rgba.buffer, w: W, h: H, ms: performance.now() - t0, transfer: [rgba.buffer] };
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') self.postMessage({ rid: m.rid, ...(await init(m)) });
    else if (m.type === 'run') {
      const r = await run(m), { transfer } = r;
      delete r.transfer;
      self.postMessage({ rid: m.rid, ...r }, transfer);
    }
  } catch (e) {
    self.postMessage({ rid: m.rid, type: 'error', error: (e && e.message) || String(e) });
  }
};
