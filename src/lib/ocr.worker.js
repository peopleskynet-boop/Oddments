// The OCR worker: PaddleOCR PP-OCRv5 (Apache 2.0) — the mobile text detector finds the lines, the East Slavic
// recogniser reads them (Russian and English in one alphabet). Off the interface thread; WebGPU when there is one.
import * as ort from 'onnxruntime-web';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import * as C from './ocrcore.js';
import { DICT } from './ocrdict.js';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
ort.env.logLevel = 'error'; // the converted models carry unused initializers: hundreds of harmless warnings per start

const MAX_SIDE = 2560, BATCH = 8;
let det = null, rec = null, device = 'wasm';

async function session(url, eps) {
  let last;
  for (const ep of eps) {
    try { return { s: await ort.InferenceSession.create(url, { executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: 3 }), ep }; } catch (e) { last = e; }
  }
  throw last;
}

async function init({ urls, gpu }) {
  const eps = gpu && 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];
  const d = await session(urls.det, eps);
  det = d.s; device = d.ep;
  // lines are short and their widths change all the time — the CPU handles them without re-planning the GPU graph
  rec = (await session(urls.rec, ['wasm'])).s;
  return { device };
}

// the picture over white, the long side at most 2560 (big photos would only cost memory: text there is large)
function pixels(bitmap) {
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k)), h = Math.max(1, Math.round(bitmap.height * k));
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return g.getImageData(0, 0, w, h);
}

async function read(img) {
  const d = C.detInput(img, 1280);
  const o = await det.run({ x: new ort.Tensor('float32', d.x, [1, 3, d.h, d.w]) });
  const boxes = C.detBoxes(o[det.outputNames[0]].data, d.w, d.h, d.sx, d.sy).slice(0, 300);
  const crops = boxes.map((b) => ({ b, c: C.recCrop(img, b) })).sort((p, q) => p.c.w - q.c.w);
  const items = [];
  for (let i = 0; i < crops.length; i += BATCH) {
    const part = crops.slice(i, i + BATCH), { x, W } = C.recBatch(part.map((p) => p.c));
    const r = await rec.run({ x: new ort.Tensor('float32', x, [part.length, 3, C.REC_H, W]) });
    const t = r[rec.outputNames[0]], [, steps, classes] = t.dims;
    C.ctcDecode(t.data, part.length, steps, classes, DICT).forEach((res, k) => { if (C.goodLine(res)) items.push({ ...part[k].b, ...res }); });
  }
  items.sort((p, q) => p.row - q.row || p.x - q.x);
  // the lines with their boxes in 0..1 of the picture: what the personal-data mask covers (pii.js)
  const lines = items.map((it) => ({ x: it.x / img.width, y: it.y / img.height, w: it.w / img.width, h: it.h / img.height, text: C.fixScripts(it.text) }));
  return { text: C.joinLines(items), lines };
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') self.postMessage({ type: 'ready', rid: m.rid, ...(await init(m)) });
    else if (m.type === 'read') {
      const bitmap = m.bitmap || await createImageBitmap(await (await fetch(m.url)).blob());
      self.postMessage({ type: 'text', rid: m.rid, ...(await read(pixels(bitmap))) });
    }
  } catch (e) {
    self.postMessage({ type: 'error', rid: m.rid, error: (e && e.message) || String(e) });
  }
};
