// «Убрать фон»: BEN2 (Prama, MIT) on this computer's graphics card, then the edge made the photo's own (matte.js: a
// colour guided filter at full size and the old background's colour taken off the edges). Chosen on a bench of hard
// pictures (hair, fur, whiskers, a dandelion, bicycle spokes, glass): BiRefNet does not fit in the browser's memory —
// its deformable convolution is exported as 400 MB tensors — and BRIA RMBG-2.0 is non-commercial.
// The model (223 MB) is downloaded once, on the first use, into $APPLOCALDATA/ai/ben2. It needs WebGPU: on the
// processor it runs out of the WebAssembly memory.
//   canCutout(it)                → a picture this can work on
//   cutoutItem(it, onProgress)   → { rgba, w, h, ms } (the cut-out, full size)
//   saveCutout(it, blob)         → a PNG copy next to the original
import * as fs from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { addFromBlobs, saveIndex } from './library.js';
import { maskSource, pictureUrl } from './masker.js';
import { workerRpc } from './workerrpc.js';
import { downloadFile } from './download.js';
import { t } from './i18n.js';

export const CUTOUT_MODEL = {
  id: 'ben2',
  repo: 'PramaLLC/BEN2',
  rev: 'e48a20765fb421d19dcdb0bf3cc61e802ca5ec8f', // pinned: the file and its size are this revision
  file: { path: 'BEN2_Base.onnx', size: 222932053 },
};
// the largest picture: its full-size RGBA lives twice in memory (in and out) and is worked on in one go
export const MAX_PIXELS = 40e6;

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const base = () => { try { return localStorage.getItem('perch.cutout.base') || ''; } catch (e) { return ''; } };
const hfUrl = () => (base() ? base().replace(/\/$/, '') + '/' + CUTOUT_MODEL.file.path
  : `https://huggingface.co/${CUTOUT_MODEL.repo}/resolve/${CUTOUT_MODEL.rev}/${CUTOUT_MODEL.file.path}`);

export const canCutout = (it) => !!it && !it.trashed && !!maskSource(it) && it.kind !== 'gif';

let gpuChecked = null;
export const hasGpu = () => (gpuChecked ||= (async () => {
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; }
})());

const modelFile = async () => {
  const dir = await join(await appLocalDataDir(), 'ai', CUTOUT_MODEL.id);
  return { dir, p: await join(dir, CUTOUT_MODEL.file.path.split('/').pop()) };
};
// the download goes on when the window is closed (it is the model's, not the window's): opening again joins it — two
// downloads wrote the same .part at once before — and the newest window gets the progress
let fetching = null, fetchGot = 0, fetchTo = null;
async function modelUrl(onProgress) {
  if (!inApp()) return hfUrl();
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const { dir, p } = await modelFile();
  const f = CUTOUT_MODEL.file;
  fetchTo = onProgress;
  const have = await fs.stat(p).then((st) => st.size === f.size).catch(() => false);
  if (!have) {
    fetching ||= (async () => {
      await fs.mkdir(dir, { recursive: true });
      fetchGot = 0;
      await downloadFile(hfUrl(), p, { size: f.size, what: 'модель удаления фона', onBytes: (n) => { fetchGot += n; if (fetchTo) fetchTo({ phase: 'download', got: fetchGot, total: f.size }); } });
    })().finally(() => { fetching = null; });
    await fetching;
  }
  return convertFileSrc(p);
}
// before a run the window asks once: 'ready' — on this computer (or a local copy for the browser build), 'fetching' —
// still downloading from an earlier open, 'missing' — the first use, the size to ask about (audit 29.10)
export async function cutoutModelState() {
  if (!inApp()) return base() ? 'ready' : 'missing';
  if (fetching) return 'fetching';
  const { p } = await modelFile();
  return (await fs.stat(p).then((st) => st.size === CUTOUT_MODEL.file.size).catch(() => false)) ? 'ready' : 'missing';
}
// how far a download is (null — none): the window says so when it is closed in the middle
export const cutoutFetching = () => (fetching ? { got: fetchGot, total: CUTOUT_MODEL.file.size } : null);

let worker = null, ready = null, onStep = null;
async function boot(onProgress) {
  if (worker && ready) return ready;
  if (!(await hasGpu())) throw new Error('нужна видеокарта с WebGPU — на процессоре модели не хватает памяти');
  const w = worker = workerRpc(() => {
    const x = new Worker(new URL('./cutout.worker.js', import.meta.url), { type: 'module' });
    x.addEventListener('message', ({ data: m }) => { if (m && m.type === 'progress' && onStep) onStep(m); });
    return x;
  }, () => { if (worker === w) { worker = null; ready = null; } });
  const r = ready = (async () => {
    const url = await modelUrl(onProgress);
    // closed while the model was downloading: this worker is gone, a newer window may have its own
    if (worker !== w) throw new Error('удаление фона остановлено');
    onProgress && onProgress({ phase: 'loading' });
    return w.call({ type: 'init', url });
  })();
  r.catch(() => { if (worker === w) stopCutout(); });
  return r;
}
// the window closed mid-run: the worker stops; the next call starts it again (and loads the model again)
export function stopCutout() {
  if (worker) worker.terminate('удаление фона остановлено');
  worker = null; ready = null; onStep = null; fetchTo = null;
}

export async function cutoutItem(it, onProgress) {
  await boot(onProgress);
  const url = await pictureUrl(it);
  let bitmap;
  try { bitmap = await createImageBitmap(await (await fetch(url)).blob()); } finally { URL.revokeObjectURL(url); }
  if (bitmap.width * bitmap.height > MAX_PIXELS) { bitmap.close(); throw new Error(`картинка слишком большая (${Math.round(bitmap.width * bitmap.height / 1e6)} Мп, можно до ${MAX_PIXELS / 1e6})`); }
  onStep = (m) => onProgress && onProgress({ phase: m.phase });
  try {
    const r = await worker.call({ type: 'run', bitmap }, [bitmap]);
    return { rgba: new Uint8ClampedArray(r.rgba), w: r.w, h: r.h, ms: r.ms };
  } finally { onStep = null; }
}

// RGBA → PNG; `trim` cuts the empty margins (fully transparent rows and columns) away
export async function pngOf(rgba, w, h, trim = false) {
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  if (trim) {
    const solid = (x, y) => rgba[(y * w + x) * 4 + 3] > 2;
    const rowHas = (y) => { for (let x = 0; x < w; x++) if (solid(x, y)) return true; return false; };
    const colHas = (x) => { for (let y = y0; y < y1; y++) if (solid(x, y)) return true; return false; };
    while (y0 < y1 && !rowHas(y0)) y0++;
    while (y1 > y0 && !rowHas(y1 - 1)) y1--;
    while (x0 < x1 && !colHas(x0)) x0++;
    while (x1 > x0 && !colHas(x1 - 1)) x1--;
    if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = w; y1 = h; }
  }
  const c = new OffscreenCanvas(x1 - x0, y1 - y0);
  c.getContext('2d').putImageData(new ImageData(rgba, w, h), -x0, -y0);
  return c.convertToBlob({ type: 'image/png' });
}

export async function saveCutout(it, blob) {
  const base = it.name.replace(/\.[^.]+$/, '');
  const [copy] = await addFromBlobs([{ blob, name: `${base} — ${t('без фона')}.png`, source: it.url || '' }], { folder: (it.folders || [])[0] || null });
  if (!copy) return null;
  copy.folders = [...new Set([...(copy.folders || []), ...(it.folders || [])])];
  copy.tags = [...new Set([...(copy.tags || []), ...(it.tags || [])])];
  copy.cutOf = it.id; // optional field: which file this is a cut-out of
  saveIndex();
  return copy;
}
