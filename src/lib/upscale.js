// «Увеличить ×2 / ×4»: Real-ESRGAN x4plus (Xintao Wang et al., BSD-3 — fine for personal, company and paid use) on this
// computer. It draws the detail a plain resize blurs: textures, edges, lines; fine text on UI screenshots it may
// «re-draw» slightly — the window shows before / after. The model (34 MB, float16) is downloaded once, on the first use,
// into $APPLOCALDATA/ai/<model>; the browser build reads it straight from Hugging Face.
//   canUpscale(it)                     → a picture this can enlarge
//   upscaleItem(it, scale, onProgress) → { blob, w, h, device } (PNG of the whole picture)
//   saveUpscaled(it, blob, scale)      → the copy as a new library item next to the original
import * as fs from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { addFromBlobs, saveIndex } from './library.js';
import { maskSource, pictureUrl } from './masker.js';
import { workerRpc } from './workerrpc.js';
import { downloadFile } from './download.js';

export const UPSCALE_MODEL = {
  id: 'realesrgan-x4plus',
  repo: 'imgdesignart/realesrgan-x4-onnx',
  rev: '138909edd364e7da67b5803c3918281e0428d19b', // pinned: the file and its size below are this revision
  file: { path: 'onnx/model_fp16.onnx', size: 33749677 },
};
// the largest result: a canvas this big still encodes (Chromium refuses ~268 M pixels; PNG of 64 M is ~100–200 MB)
export const MAX_OUT = 64e6;

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const base = () => { try { return localStorage.getItem('perch.ai.base') || ''; } catch (e) { return ''; } };
const hfUrl = () => (base() ? base().replace(/\/$/, '') + '/' + UPSCALE_MODEL.file.path
  : `https://huggingface.co/${UPSCALE_MODEL.repo}/resolve/${UPSCALE_MODEL.rev}/${UPSCALE_MODEL.file.path}`);

export const canUpscale = (it) => !!it && !it.trashed && !!maskSource(it) && it.kind !== 'gif' && it.ext !== 'svg';
// how big the result would be, and whether it fits
export function outSize(it, scale) {
  const w = Math.round((it.w || 0) * scale), h = Math.round((it.h || 0) * scale);
  return { w, h, fits: !w || w * h <= MAX_OUT };
}

let gpuChecked = null;
const hasGpu = () => (gpuChecked ||= (async () => {
  try { const a = navigator.gpu && await navigator.gpu.requestAdapter(); return !!(a && a.features && a.features.has('shader-f16')); } catch (e) { return false; }
})());

// the model file: in the app downloaded once (with progress, resumed if cut off), in the browser build a web address
async function modelUrl(onProgress) {
  if (!inApp()) return hfUrl();
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const dir = await join(await appLocalDataDir(), 'ai', UPSCALE_MODEL.id);
  const p = await join(dir, UPSCALE_MODEL.file.path.split('/').pop());
  const f = UPSCALE_MODEL.file;
  const have = await fs.stat(p).then((st) => st.size === f.size).catch(() => false);
  if (!have) {
    await fs.mkdir(dir, { recursive: true });
    let got = 0;
    await downloadFile(hfUrl(), p, { size: f.size, what: 'модель увеличения', onBytes: (n) => { got += n; onProgress && onProgress({ phase: 'download', got, total: f.size }); } });
  }
  return convertFileSrc(p);
}

let worker = null, ready = null, onTile = null;
function start() {
  worker = workerRpc(() => {
    const w = new Worker(new URL('./upscale.worker.js', import.meta.url), { type: 'module' });
    w.addEventListener('message', ({ data: m }) => { if (m && m.type === 'progress' && onTile) onTile(m); });
    return w;
  }, () => { worker = null; ready = null; });
}
async function boot(onProgress) {
  if (worker && ready) return ready;
  start();
  ready = (async () => {
    const url = await modelUrl(onProgress);
    onProgress && onProgress({ phase: 'loading' });
    return worker.call({ type: 'init', url, gpu: await hasGpu() });
  })();
  ready.catch(() => { stopUpscale(); });
  return ready;
}
// stops a run in progress (the window closed); the next call starts the worker again
export function stopUpscale() {
  if (worker) worker.terminate('увеличение остановлено');
  worker = null; ready = null; onTile = null;
}

export async function upscaleItem(it, scale, onProgress) {
  const { device } = await boot(onProgress);
  const url = await pictureUrl(it);
  let bitmap;
  try { bitmap = await createImageBitmap(await (await fetch(url)).blob()); } finally { URL.revokeObjectURL(url); }
  if (bitmap.width * bitmap.height * scale * scale > MAX_OUT) { bitmap.close(); throw new Error(`картинка слишком большая для ×${scale}`); }
  onTile = (m) => onProgress && onProgress({ phase: 'run', done: m.done, total: m.total, left: m.left });
  // bigger tiles on the graphics card (fewer runs), smaller on the processor (the progress moves)
  const tile = device === 'webgpu' ? 192 : 96;
  try { return await worker.call({ type: 'run', bitmap, scale, tile }, [bitmap]); } finally { onTile = null; }
}

export async function saveUpscaled(it, blob, scale) {
  const base = it.name.replace(/\.[^.]+$/, '');
  const [copy] = await addFromBlobs([{ blob, name: `${base} @${scale}x.png`, source: it.url || '' }], { folder: (it.folders || [])[0] || null });
  if (!copy) return null;
  copy.folders = [...new Set([...(copy.folders || []), ...(it.folders || [])])];
  copy.tags = [...new Set([...(copy.tags || []), ...(it.tags || [])])];
  copy.upscaleOf = it.id; // optional field: which file this is an enlarged copy of
  saveIndex();
  return copy;
}
