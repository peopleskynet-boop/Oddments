// Text on pictures, read on this computer: screenshots, posters, interface screens become findable by what is
// written on them («Оплата», «Dior», «Outlook»), and the text can be copied. PaddleOCR PP-OCRv5 (Apache 2.0): the
// mobile detector (4.8 MB) and the East Slavic recogniser (7.9 MB, Russian + English) — downloaded once into
// $APPLOCALDATA/ocr, 13 MB, then offline. Checked on the user's library (157 pictures): 0.4 s per picture on the CPU,
// Russian app screens read almost word for word; small stylised text on mock-ups less so.
// What it found goes into the item: `ocr` (the text, rows on lines), `ocrV` (engine version), `ocrT` (the file read)
// — optional fields, no migration. Pictures without text get `ocr: ''`, so they are not read again.
import * as fs from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { S, ui } from '../state.js';
import { assetUrl, saveIndex } from './library.js';
import { readPref, writePref } from './prefs.js';
import { workerRpc } from './workerrpc.js';
import { downloadFile } from './download.js';
import { piiTypes, PII_V } from './pii.js';

export const OCR_V = 'pp5-1';
const FILES = {
  det: { repo: 'PaddlePaddle/PP-OCRv5_mobile_det_onnx', rev: 'e6f4fa85f00e168c862bc462aebca69eef9b3d3d', size: 4826518, name: 'det.onnx' },
  rec: { repo: 'PaddlePaddle/eslav_PP-OCRv5_mobile_rec_onnx', rev: '9a32171fc5718746875e1a261818884517975013', size: 7887627, name: 'rec-eslav.onnx' },
};
export const OCR_MB = Math.round(Object.values(FILES).reduce((a, f) => a + f.size, 0) / 1e6);
const hf = (f) => `https://huggingface.co/${f.repo}/resolve/${f.rev}/inference.onnx`;
const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const MAX_TEXT = 4000;

/* ---------- state the interface reads ---------- */
const KEY = 'perch.ocr';
const prefs = readPref(KEY, { on: true });
const keep = () => writePref(KEY, prefs);
// status: off · download · loading · ready · error
export const OCR = { status: 'off', device: '', done: 0, todo: 0, error: '', rate: 0 };
const subs = new Set();
export const onOcr = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((fn) => { try { fn(OCR); } catch (e) { console.warn(e); } });
export const ocrOn = () => prefs.on;

/* ---------- which file of an item is read ---------- */
const SKIP = new Set(['model', 'material', 'font', 'audio']); // their pictures are renders and samples, not text
const RAW = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;
export function ocrSource(it) {
  if (it.trashed || SKIP.has(it.kind)) return '';
  if (it.kind === 'image' && it.file && RAW.test(it.file)) return it.file; // the original: thumbnails lose small text
  if (it.preview) return it.preview; // PSD: the full render
  return it.thumb || ''; // video frame, PDF page, link cover
}
const needs = (it) => { const s = ocrSource(it); return !!s && (it.ocrV !== OCR_V || it.ocrT !== s); };

/* ---------- the worker ---------- */
let worker = null, ready = null;
const call = (msg, transfer) => (worker ? worker.call(msg, transfer) : Promise.reject(new Error('распознавание не запущено')));
async function urls() {
  if (!inApp()) return { det: hf(FILES.det), rec: hf(FILES.rec) }; // the browser build reads Hugging Face directly
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const dir = await join(await appLocalDataDir(), 'ocr');
  await fs.mkdir(dir, { recursive: true });
  const out = {};
  for (const [k, f] of Object.entries(FILES)) {
    const p = await join(dir, f.name);
    const have = await fs.stat(p).then((st) => st.size === f.size).catch(() => false);
    if (!have) {
      OCR.status = 'download'; emit();
      await downloadFile(hf(f), p, { size: f.size, stop: () => !prefs.on, what: 'файл модели распознавания текста' });
    }
    out[k] = convertFileSrc(p);
  }
  return out;
}
function start() {
  if (ready) return ready;
  ready = (async () => {
    worker = workerRpc(() => new Worker(new URL('./ocr.worker.js', import.meta.url), { type: 'module' }), (msg) => fail('фоновый поток упал: ' + msg));
    const gpu = await (async () => { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; } })();
    const u = await urls();
    OCR.status = 'loading'; emit();
    const r = await call({ type: 'init', urls: u, gpu });
    OCR.device = r.device; OCR.status = 'ready'; OCR.error = ''; emit();
  })().catch((e) => { fail((e && e.message) || String(e)); throw e; });
  return ready;
}
function fail(msg) {
  OCR.status = 'error'; OCR.error = msg; emit();
  if (worker) worker.terminate(msg);
  worker = null; ready = null;
}

// a worker cannot decode SVG: it is drawn here at 1600 px on its long side
async function svgBitmap(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const k = 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((img.naturalWidth || 1) * k)); c.height = Math.max(1, Math.round((img.naturalHeight || 1) * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return createImageBitmap(c);
}

// text of any picture by its URL (the feed checks pictures of posts for ad markings with it). One picture at a time:
// two runs of the same model at once stall onnxruntime on WebGPU, so the library pass and the feed take turns.
let line = Promise.resolve();
export function readUrl(url, svg = false) {
  return readLines(url, svg).then((r) => r.text);
}
// the text and its lines with boxes (0..1 of the picture): the personal-data mask needs where each line is
export function readLines(url, svg = false) {
  const job = line.then(async () => {
    await start();
    const msg = svg ? { type: 'read', bitmap: await svgBitmap(url) } : { type: 'read', url };
    const r = await call(msg, msg.bitmap ? [msg.bitmap] : []);
    return { text: r.text, lines: r.lines || [] };
  });
  line = job.catch(() => {});
  return job;
}

/* ---------- reading the library ---------- */
// one picture at a time while the window is idle, newest first; the index is saved every 20 pictures and at the end
let running = false;
async function pass() {
  if (running || !prefs.on) return;
  const first = S.items.filter(needs);
  if (!first.length) { OCR.todo = 0; emit(); return; }
  running = true;
  try {
    await start();
    let n = 0, t0 = Date.now();
    for (;;) {
      const queue = S.items.filter(needs).sort((a, b) => b.added - a.added);
      if (!queue.length) break;
      OCR.todo = queue.length; emit();
      for (const it of queue) {
        if (!prefs.on || OCR.status !== 'ready') return;
        if (!needs(it)) { OCR.todo--; continue; }
        if (document.hidden) await new Promise((r) => setTimeout(r, 1500)); // the window is away: slower
        const src = ocrSource(it);
        try {
          const text = await readUrl(assetUrl(src), /\.svg$/i.test(src));
          it.ocr = text.slice(0, MAX_TEXT);
        } catch (e) {
          if (OCR.status !== 'ready') return;
          console.warn('ocr: не прочиталась', it.name, e);
          it.ocr = ''; // a broken file is not tried again until it changes
        }
        it.ocrV = OCR_V; it.ocrT = src;
        const had = !!it.pii;
        markPii(it);
        if (had !== !!it.pii && ui.syncCard) ui.syncCard(it.id);
        n++; OCR.done++; OCR.todo--; OCR.rate = (Date.now() - t0) / n;
        if (n % 20 === 0) saveIndex();
        emit();
        if (S.sel.has(it.id) && ui.renderInsp) ui.renderInsp();
        await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 400 }) : setTimeout(r, 30)));
      }
    }
  } catch (e) { /* fail() has said it */ } finally {
    running = false;
    saveIndex();
    OCR.todo = S.items.filter(needs).length;
    emit();
  }
}
let kickT = null;
export function ocrKick() {
  if (!prefs.on) return;
  clearTimeout(kickT);
  kickT = setTimeout(pass, 1500); // after an import the AI and thumbnails go first
}
// personal data in the text (pii.js): `pii` — the kinds found (card, phone, name…), for the card's mark and the mask;
// `piiV` — by which rules. A picture the person said is clean (`piiNo`) keeps no mark.
export function markPii(it) {
  const t = it.ocr && !it.piiNo ? piiTypes(it.ocr) : [];
  if (t.length) it.pii = t; else delete it.pii;
  it.piiV = PII_V;
}
export function initOcr() {
  let n = 0;
  for (const it of S.items) if (it.ocrV === OCR_V && it.piiV !== PII_V) { markPii(it); n++; }
  if (n) saveIndex();
  OCR.done = S.items.filter((i) => i.ocrV === OCR_V).length;
  if (prefs.on) ocrKick(); else emit();
}
export function setOcrOn(on) {
  prefs.on = on; keep();
  if (on) { OCR.status = OCR.status === 'error' ? 'off' : OCR.status; ocrKick(); } else { if (worker) worker.terminate(); worker = null; ready = null; OCR.status = 'off'; emit(); }
}
export async function deleteOcrModel() {
  setOcrOn(false);
  if (inApp()) await fs.remove(await join(await appLocalDataDir(), 'ocr'), { recursive: true }).catch(() => {});
}
export const ocrRead = () => S.items.filter((i) => i.ocrV === OCR_V && i.ocr).length;
