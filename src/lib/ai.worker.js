// The AI worker: SigLIP 2 large (Google, Apache 2.0) turns pictures and search phrases into vectors in one
// space, so «рука с наушниками» lands next to such pictures. It runs here, off the interface thread, so the
// window never stutters while the library is being studied. WebGPU when the machine has it, WebAssembly otherwise.
import * as ort from 'onnxruntime-web';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import { Tokenizer } from '@huggingface/tokenizers';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// threads need a cross-origin-isolated page; without it one thread (still correct, slower)
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

const SIZE = 256, LEN = 64;
let vision = null, text = null, tok = null, device = 'wasm';

// onnxruntime keeps one «a run is in progress» flag for the whole wasm module: two runs at once — the same model
// twice, or pictures and a search phrase — fail with «Session already started». Every model call waits its turn
// (a phrase waits for at most one picture: the library is studied one picture at a time).
let turn = Promise.resolve();
const inTurn = (fn) => {
  const r = turn.then(fn);
  turn = r.catch(() => {});
  return r;
};

const norm = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  s = Math.sqrt(s) || 1;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] / s;
  return out;
};

async function session(url, eps) {
  let last;
  for (const ep of eps) {
    try { return { s: await ort.InferenceSession.create(url, { executionProviders: [ep], graphOptimizationLevel: 'all' }), ep }; } catch (e) { last = e; }
  }
  throw last;
}

async function init({ urls, gpu }) {
  const json = async (u) => (await fetch(u)).json();
  tok = new Tokenizer(await json(urls.tokenizer), await json(urls.tokenizerConfig));
  const eps = gpu && 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];
  const v = await session(urls.vision, eps);
  vision = v.s; device = v.ep;
  text = (await session(urls.text, ['wasm'])).s; // a phrase is tiny: the CPU answers in milliseconds
  return { device };
}

// the picture as the model wants it: squeezed to 256×256 (bilinear), each channel x/127.5 − 1, planar RGB
function pixels(bitmap) {
  const c = new OffscreenCanvas(SIZE, SIZE);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0, SIZE, SIZE);
  bitmap.close();
  const d = g.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, f = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    f[i] = d[i * 4] / 127.5 - 1;
    f[n + i] = d[i * 4 + 1] / 127.5 - 1;
    f[2 * n + i] = d[i * 4 + 2] / 127.5 - 1;
  }
  return f;
}

async function embedImage(bitmap) {
  const px = new ort.Tensor('float32', pixels(bitmap), [1, 3, SIZE, SIZE]);
  const r = await inTurn(() => vision.run({ pixel_values: px }));
  return norm(r.pooler_output.data);
}

async function embedText(q) {
  const ids = tok.encode(q.toLowerCase()).ids.slice(0, LEN);
  while (ids.length < LEN) ids.push(0); // <pad>
  const inp = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, LEN]);
  const r = await inTurn(() => text.run({ input_ids: inp }));
  return norm(r.pooler_output.data);
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') self.postMessage({ type: 'ready', rid: m.rid, ...(await inTurn(() => init(m))) });
    else if (m.type === 'image') {
      // the thumbnail is read here (asset / blob URL), so the interface thread only sends its address
      const bitmap = m.bitmap || await createImageBitmap(await (await fetch(m.url)).blob());
      const vec = await embedImage(bitmap);
      self.postMessage({ type: 'vec', rid: m.rid, vec }, [vec.buffer]);
    }
    else if (m.type === 'text') { const vec = await embedText(m.text); self.postMessage({ type: 'vec', rid: m.rid, vec }, [vec.buffer]); }
  } catch (e) {
    self.postMessage({ type: 'error', rid: m.rid, error: (e && e.message) || String(e) });
  }
};
