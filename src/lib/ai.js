// Search by meaning («наушники серого цвета», «рука с наушниками», «персонаж с голубыми волосами»), on this
// computer, offline. SigLIP 2 large (Google, Apache 2.0 — fine for personal, company and paid use) was picked on
// the user's own library: 187 pictures, 38 Russian queries, the right picture in the top five for 95% of them.
// The model (~890 MB) is downloaded once, when the person turns the feature on — the installer does not grow.
// Each picture becomes a vector of 1024 numbers (its «fingerprint»), kept in the library folder next to
// index.json and tagged with the model, so another model later simply studies the library again.
import * as fs from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { S, ui } from '../state.js';
import { absPath, assetUrl, getRoot, saveIndex } from './library.js';
import { VOCAB, VOCAB_V, wordStats, tagsFor } from './aitags.js';
import * as C from './aicloud.js';
import { settings } from '../ui/settings.js';
import { readPref, writePref } from './prefs.js';
import { workerRpc } from './workerrpc.js';
import { downloadFile } from './download.js';

export const MODEL = {
  id: 'siglip2-large',
  name: 'SigLIP 2 large',
  repo: 'onnx-community/siglip2-large-patch16-256-ONNX',
  rev: 'c03fb63ddd5fe363212cbd08110f92a35250db6a', // pinned: the files and their sizes below are this revision
  dim: 1024,
  files: {
    vision: { path: 'onnx/vision_model_int8.onnx', size: 319618816 }, // replaced by VISION_GPU on a machine with WebGPU
    text: { path: 'onnx/text_model_int8.onnx', size: 568343664 },
    tokenizer: { path: 'tokenizer.json', size: 34363039 },
    tokenizerConfig: { path: 'tokenizer_config.json', size: 47240 },
  },
};
// With WebGPU the picture half runs on the graphics card in 4-bit / float16 (int8 operations are not on the GPU and fell
// back to one CPU thread: 2.2 s per picture; q4f16 does 77 ms and was as accurate as fp16 on the test); without it the int8
// file on the CPU. Both give vectors of the same model.
const VISION_GPU = { path: 'onnx/vision_model_q4f16.onnx', size: 181764164 };
let gpuChecked = null;
const hasGpu = () => (gpuChecked ||= (async () => { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; } })());
async function files() { return { ...MODEL.files, ...((await hasGpu()) ? { vision: VISION_GPU } : {}) }; }
export const MODEL_MB = Math.round(Object.values(MODEL.files).reduce((a, f) => a + f.size, 0) / 1e6);

// what a search shows: pictures at least this close to the phrase, and not far behind the best one
// (calibrated on the same 38 queries: cosine of a relevant picture 0.09–0.18, unrelated ones mostly < 0.07)
const BEHIND_BEST = 0.04;
// the same for Voyage vectors (not calibrated on the user's library yet: its cosines run higher than SigLIP's)
const VOYAGE_MIN = 0.15, VOYAGE_BEHIND = 0.06;
// Bug #63: «character» found 6 of ~14 characters, «персонаж с синими волосами» found none — on the q4f16 picture
// model (the GPU path in the exe) the scores sit low (the best ~0.06), the fixed floor 0.07 cut everything and «best −
// 0.04» kept only what was nearly as close as one top match. Now a picture is shown when it stands out from the whole
// library for this phrase: z = (score − mean) / sd ≥ Z_KEEP, at most MAX_HITS, closest first. Calibrated on the user's
// own library (vectors made by the exe, 38 labelled queries): the right picture found in 36/38 (was 30), recall
// 0.88 (was 0.61), no empty results (was 5), ~10 shown on average; «character» 13, «синие волосы» 14. Scores cannot
// tell a nonsense phrase from a real one (the best always stands out similarly), so the UI says «ближайшие по смыслу».
const MAX_HITS = 40, Z_KEEP = 1.8;
function semMin(scores) {
  const a = [...scores.values()].filter(Number.isFinite);
  if (a.length < 5) return a.length ? Math.max(...a) - BEHIND_BEST : Infinity; // a tiny library: the old way
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length) || 1e-6;
  const sorted = a.slice().sort((x, y) => y - x);
  if (cloud() && sorted[0] < VOYAGE_MIN) return Infinity;
  return Math.max(mean + Z_KEEP * sd, sorted[Math.min(sorted.length - 1, MAX_HITS - 1)]);
}

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
// localStorage['perch.ai.base'] points the files elsewhere (a local copy, for testing the browser build)
const base = () => { try { return localStorage.getItem('perch.ai.base') || ''; } catch (e) { return ''; } };
const hfUrl = (f) => (base() ? base().replace(/\/$/, '') + '/' + f.path : `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.rev}/${f.path}`);

/* ---------- state the interface reads ---------- */
const PREF_KEY = 'perch.ai';
const prefs = readPref(PREF_KEY, { on: false, paused: false, engine: 'local' });
const keepPrefs = () => writePref(PREF_KEY, prefs);

// status: off · download · loading · ready · error; device: webgpu · wasm · api
// confirm: { n, usd } — a pass through the API waits for the person to agree to its cost
// lastError: { where: 'tags' | 'search' | 'save' | 'study', msg, at } — a failure outside the start, shown in the pill
// and in Settings (bugs #46–48: in the exe there is no console, errors used to vanish there); searching: a search
// phrase is being turned into a vector right now; failed: pictures that could not be studied this session
export const AI = { status: 'off', device: '', got: 0, total: 0, done: 0, todo: 0, rate: 0, error: '', paused: prefs.paused, tagging: 0, tagTotal: 0, phase: '', tagged: -1, confirm: null, lastError: null, searching: false, failed: 0 };
const subs = new Set();
export const onAi = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((fn) => { try { fn(AI); } catch (e) { console.warn(e); } });
export const aiOn = () => prefs.on;
function note(where, e) {
  console.warn('ai:', where, e);
  AI.lastError = { where, msg: (e && e.message) || String(e), at: Date.now() };
  emit();
}
export function clearAiError() { AI.lastError = null; emit(); }
export const aiReady = () => AI.status === 'ready';
// where the AI runs: 'local' (SigLIP 2 on this computer) or 'api' (aicloud.js: Claude describes, Voyage embeds)
const cloud = () => prefs.engine === 'api';
export const aiEngine = () => prefs.engine;
export async function setEngine(e) {
  if (e === prefs.engine) return;
  const was = prefs.on;
  if (was) await turnOff();
  prefs.engine = e; keepPrefs();
  words = null; order = null;
  if (was) turnOn();
}
const vecId = () => (cloud() ? C.VOYAGE.id : MODEL.id);

/* ---------- the worker ---------- */
let worker = null;
const call = (msg, transfer) => (worker ? worker.call(msg, transfer) : Promise.reject(new Error('ИИ не запущен')));
function startWorker() {
  // a crash fails what was waiting (workerrpc.js) and the next start makes a new worker
  worker = workerRpc(() => new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' }),
    (msg) => { worker = null; fail('Фоновый поток ИИ упал: ' + msg); });
}

/* ---------- model files ---------- */
async function modelDir() { return join(await appLocalDataDir(), 'ai', MODEL.id); }

// in the app: download into $APPLOCALDATA/ai/<model> once, with progress; in the browser build the worker
// reads the files straight from Hugging Face (the demo has no disk)
async function modelUrls() {
  const FILES = await files();
  if (!inApp()) return Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, hfUrl(f)]));
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const dir = await modelDir();
  await fs.mkdir(dir, { recursive: true });
  const out = {};
  const list = Object.entries(FILES);
  AI.total = list.reduce((a, [, f]) => a + f.size, 0);
  AI.got = 0;
  for (const [k, f] of list) {
    const p = await join(dir, f.path.split('/').pop());
    const have = await fs.stat(p).then((st) => st.size === f.size).catch(() => false);
    if (!have) { AI.status = 'download'; emit(); await download(hfUrl(f), p, f.size); }
    AI.got += have ? f.size : 0;
    out[k] = convertFileSrc(p);
  }
  return out;
}

// Audit #42: the download stops when AI is switched off or the model deleted (the abort controller), and a broken
// download goes on from where it stopped: the .part file stays, the next try asks for the rest (HTTP Range).
let dlAbort = null;
async function download(url, path, size) {
  dlAbort = new AbortController();
  let t = 0;
  try {
    await downloadFile(url, path, { size, signal: dlAbort.signal, stop: () => !prefs.on, what: 'файл модели',
      onBytes: (n) => { AI.got += n; if (Date.now() - t > 250) { t = Date.now(); emit(); } } });
  } finally { dlAbort = null; }
  emit();
}

export async function deleteModel() {
  await turnOff();
  if (inApp()) await fs.remove(await join(await appLocalDataDir(), 'ai'), { recursive: true }).catch(() => {});
}
export async function modelOnDisk() {
  if (!inApp()) return false;
  try {
    const dir = await modelDir();
    for (const f of Object.values(await files())) { const st = await fs.stat(await join(dir, f.path.split('/').pop())); if (st.size !== f.size) return false; }
    return true;
  } catch (e) { return false; }
}

/* ---------- vectors: <library>/ai/<model>.bin + .json ---------- */
const vecs = new Map(); // id → Float32Array
let srcOf = {}; // id → the thumbnail the vector was made from (a new thumbnail means study again)
let loadedRoot = '', saveT = null;
const vecFile = () => absPath(`ai/${vecId()}.bin`), metaFile = () => absPath(`ai/${vecId()}.json`);
const libKey = () => getRoot() + '|' + vecId();

async function loadVectors() {
  if (loadedRoot === libKey()) return;
  loadedRoot = libKey();
  vecs.clear(); srcOf = {};
  try {
    const meta = JSON.parse(await fs.readTextFile(metaFile()));
    if (meta.model !== vecId() || meta.dim !== MODEL.dim) return;
    const buf = await fs.readFile(vecFile());
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    meta.ids.forEach((id, i) => {
      const v = all.slice(i * MODEL.dim, (i + 1) * MODEL.dim);
      if (S.byId.has(id) && v.some((x) => x !== 0)) vecs.set(id, v); // pictures that failed last time are tried again
    });
    srcOf = meta.src || {};
  } catch (e) { /* first run */ }
}
function saveVectors() {
  clearTimeout(saveT);
  const file = vecFile(), meta = metaFile(), model = vecId(); // the engine may change before the timer fires
  saveT = setTimeout(async () => {
    const ids = [...vecs.keys()];
    const all = new Float32Array(ids.length * MODEL.dim);
    ids.forEach((id, i) => all.set(vecs.get(id), i * MODEL.dim));
    try {
      await fs.mkdir(absPath('ai'), { recursive: true });
      await fs.writeFile(file + '.tmp', new Uint8Array(all.buffer));
      await fs.rename(file + '.tmp', file);
      const src = {};
      ids.forEach((id) => { src[id] = srcOf[id]; });
      await fs.writeTextFile(meta, JSON.stringify({ model, dim: MODEL.dim, ids, src }));
    } catch (e) { note('save', e); }
  }, 1500);
}

/* ---------- studying the library ---------- */
// everything with a picture: images, GIF, video frames, PDF pages, model renders, link covers
const studyable = (it) => !it.trashed && !!it.thumb;
const needs = (it) => studyable(it) && (!vecs.has(it.id) || srcOf[it.id] !== it.thumb);
let running = false;

async function svgBitmap(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256); // icons are drawn on white, as the eye sees them
  g.drawImage(img, 0, 0, 256, 256);
  return createImageBitmap(c);
}

// The queue is built once per pass, newest first (what was just added is searchable right away); files added while
// a pass runs are picked up by the next one. The vectors file is written at most every 30 s and at the end
// (audit #41: rewriting it every 20 pictures came to ~2.5 GB of writes for 5,000 pictures).
const SAVE_EVERY = 30000;
// what is studied / left, counted from the vectors (bug #61: these were set only while a queue existed, so after a
// restart with everything studied Settings said «изучено 0 из 0» though the AI worked)
function recount() {
  AI.done = S.items.filter((i) => studyable(i) && vecs.has(i.id) && real(vecs.get(i.id))).length;
  AI.todo = cloud() ? cloudTodo().length : S.items.filter(needs).length;
}
async function study() {
  if (cloud()) return studyCloud();
  if (running || AI.status !== 'ready') return;
  recount(); emit();
  running = true;
  try {
    let t0 = Date.now(), n0 = 0, saved = Date.now();
    for (;;) {
      const queue = S.items.filter(needs).sort((a, b) => b.added - a.added);
      if (!queue.length) break;
      AI.done = S.items.filter((i) => studyable(i) && vecs.has(i.id)).length;
      AI.todo = queue.length;
      emit();
      for (const it of queue) {
        if (AI.paused || AI.status !== 'ready') return;
        if (!needs(it)) { AI.todo--; continue; } // trashed or studied meanwhile
        try {
          const url = assetUrl(it.thumb);
          // a worker cannot decode SVG: those are drawn here and handed over as pixels
          const msg = /\.svg$/i.test(it.thumb) ? { type: 'image', bitmap: await svgBitmap(url) } : { type: 'image', url };
          const { vec } = await call(msg, msg.bitmap ? [msg.bitmap] : []);
          vecs.set(it.id, vec); srcOf[it.id] = it.thumb;
          it.aiTagsV = 0; // a new look at the picture: its AI tags are chosen again
        } catch (e) {
          console.warn('ai: не изучилась', it.name, e);
          AI.failed++;
          if (AI.failed === 1 || AI.failed % 25 === 0) note('study', new Error(`не изучилась «${it.name}»: ${(e && e.message) || e}`));
          // a zero vector: never matches, not retried in this session (loadVectors drops it, so the next start tries again)
          srcOf[it.id] = it.thumb; vecs.set(it.id, new Float32Array(MODEL.dim));
        }
        n0++; AI.done++; AI.todo--;
        AI.rate = (Date.now() - t0) / n0; // ms per picture
        if (Date.now() - saved > SAVE_EVERY) { saved = Date.now(); saveVectors(); }
        emit();
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    running = false;
    saveVectors();
    AI.todo = S.items.filter(needs).length;
    emit();
  }
  if (!AI.todo && !AI.paused && AI.status === 'ready') tagAll();
}

/* ---------- the API pass (aicloud.js) ---------- */
// Claude describes and tags each picture once (it.aiDesc, it.aiTags; it.aiDescT — the thumbnail described), Voyage
// makes its vector; 6 pictures per request. A pass costing more than AUTO_USD waits for «Начать» in the AI pill.
const CLOUD_V = 'claude-1', AUTO_USD = 0.05;
const needsDesc = (it) => !!C.claudeKey() && studyable(it) && (it.aiTagsV !== CLOUD_V || it.aiDescT !== it.thumb);
const needsVec = (it) => C.hasVoyage() && needs(it);
const cloudTodo = () => S.items.filter((it) => needsDesc(it) || needsVec(it));
let approved = 0;
export function approveCloud() { approved = (AI.confirm ? AI.confirm.usd : 0) * 1.2 + 0.01; AI.confirm = null; AI.paused = prefs.paused = false; keepPrefs(); emit(); study(); }
export function declineCloud() { AI.confirm = null; setPaused(true); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const autoName = () => !!settings.aiAutoName;
async function studyCloud() {
  if (running || AI.status !== 'ready') return;
  const my = gen;
  running = true;
  let saved = Date.now(), tagged = 0, changed = false, renamed = 0;
  try {
    const queue = cloudTodo().sort((a, b) => b.added - a.added);
    AI.done = S.items.filter((it) => studyable(it) && !needsDesc(it) && !needsVec(it)).length;
    AI.todo = queue.length;
    if (!queue.length) { AI.confirm = null; approved = 0; return; }
    const cost = C.estimate(queue.filter(needsDesc).length, queue.filter(needsVec).length);
    if (cost > AUTO_USD && cost > approved) { AI.confirm = { n: queue.length, usd: cost }; return; }
    AI.confirm = null; emit();
    const t0 = Date.now();
    let n0 = 0;
    for (let i = 0; i < queue.length; i += C.PER_REQUEST) {
      if (AI.paused || AI.status !== 'ready' || my !== gen) return;
      const part = queue.slice(i, i + C.PER_REQUEST).filter((it) => needsDesc(it) || needsVec(it));
      if (!part.length) continue;
      const pics = new Map();
      for (const it of part) {
        try { pics.set(it, await C.smallCopy(it)); } catch (e) {
          console.warn('ai: не прочиталась миниатюра', it.name, e);
          it.aiTagsV = CLOUD_V; it.aiDescT = it.thumb; srcOf[it.id] = it.thumb; vecs.set(it.id, new Float32Array(MODEL.dim));
        }
      }
      const wantD = part.filter((it) => pics.has(it) && needsDesc(it)), wantV = part.filter((it) => pics.has(it) && needsVec(it));
      try {
        if (wantD.length) {
          const out = await C.describe(wantD.map((it) => pics.get(it)));
          wantD.forEach((it, k) => {
            const o = out[k];
            it.aiDesc = o.desc;
            it.aiTags = o.tags.filter((t) => !it.tags.includes(t) && !(it.aiNo || []).includes(t));
            // the English name (optional field); a file named by a camera or a screenshot tool takes it at once when
            // «Называть по-английски» is on — the old name stays in `nameWas` (the inspector can bring it back)
            if (o.name) {
              it.aiName = o.name;
              if (autoName() && C.junkName(it.name) && !it.nameWas) { it.nameWas = it.name; it.name = o.name; renamed++; }
            }
            it.aiTagsV = CLOUD_V; it.aiDescT = it.thumb;
            if (it.aiTags.length) tagged++;
          });
          changed = true;
        }
        if (wantV.length) {
          const vs = await C.embedPictures(wantV.map((it) => pics.get(it)));
          wantV.forEach((it, k) => { if (vs[k]) { vecs.set(it.id, vs[k]); srcOf[it.id] = it.thumb; } });
          order = null;
        }
      } catch (e) {
        if (e.status === 429) { await wait(60000); i -= C.PER_REQUEST; continue; } // too fast: the same pictures again in a minute
        fail('API: ' + ((e && e.message) || String(e)));
        return;
      }
      n0 += part.length; AI.done += part.length; AI.todo = Math.max(0, AI.todo - part.length);
      AI.rate = (Date.now() - t0) / n0;
      if (Date.now() - saved > SAVE_EVERY) { saved = Date.now(); saveVectors(); saveIndex(); }
      emit();
    }
    approved = 0;
  } finally {
    running = false;
    saveVectors();
    if (changed) { AI.tagged = tagged; saveIndex(); ui.refresh(); }
    if (renamed) import('../ui/dialogs.js').then((d) => d.toast(`ИИ назвал по-английски: ${renamed} — у картинок с именами вроде IMG_2034`, 4000));
    if (AI.status === 'ready') AI.todo = cloudTodo().length;
    emit();
  }
}

/* ---------- «По смыслу»: similar pictures side by side ---------- */
// k-means over the vectors (on a sample of ≤600, then every picture goes to its nearest centre), the groups chained
// so that neighbouring groups look alike, inside a group the most typical first. Cached until the vectors change.
let order = null, orderKey = '';
export function meaningRank() {
  if (AI.status !== 'ready') return null;
  const ids = [...vecs.keys()].filter((id) => S.byId.has(id) && real(vecs.get(id)));
  const key = ids.length + ':' + getRoot();
  if (order && orderKey === key) return order;
  const n = ids.length;
  if (!n && cloud()) return tagRank();
  if (!n) return null;
  const V = ids.map((id) => vecs.get(id)), D = MODEL.dim;
  const k = Math.max(2, Math.min(40, Math.round(Math.sqrt(n / 2))));
  const sample = n > 600 ? Array.from({ length: 600 }, (_, i) => V[Math.floor((i * n) / 600)]) : V;
  let C = Array.from({ length: k }, (_, i) => Float32Array.from(sample[Math.floor((i * sample.length) / k)]));
  const dotv = (a, b) => { let s = 0; for (let j = 0; j < D; j++) s += a[j] * b[j]; return s; };
  const nearest = (v) => { let bi = 0, bs = -2; for (let c = 0; c < C.length; c++) { const s = dotv(v, C[c]); if (s > bs) { bs = s; bi = c; } } return [bi, bs]; };
  for (let iter = 0; iter < 6; iter++) {
    const sum = Array.from({ length: k }, () => new Float32Array(D)), cnt = new Int32Array(k);
    for (const v of sample) { const [c] = nearest(v); cnt[c]++; for (let j = 0; j < D; j++) sum[c][j] += v[j]; }
    C = sum.map((s, c) => { if (!cnt[c]) return C[c]; let l = 0; for (let j = 0; j < D; j++) l += s[j] * s[j]; l = Math.sqrt(l) || 1; return s.map((x) => x / l); });
  }
  const at = V.map(nearest);
  // chain the groups: start anywhere, always step to the most similar unvisited one
  const seq = [0], left = new Set(Array.from({ length: k }, (_, i) => i).slice(1));
  while (left.size) { const cur = C[seq[seq.length - 1]]; let best = -1, bs = -2; for (const c of left) { const s = dotv(cur, C[c]); if (s > bs) { bs = s; best = c; } } seq.push(best); left.delete(best); }
  const pos = new Map(seq.map((c, i) => [c, i]));
  const sorted = ids.map((id, i) => [id, pos.get(at[i][0]), at[i][1]]).sort((a, b) => a[1] - b[1] || b[2] - a[2]);
  order = new Map(sorted.map(([id], i) => [id, i]));
  orderKey = key;
  return order;
}

// API without Voyage: pictures grouped by their most common AI tag, the bigger groups first
function tagRank() {
  const list = S.items.filter((it) => it.aiTags && it.aiTags.length);
  if (!list.length) return null;
  const freq = new Map();
  list.forEach((it) => it.aiTags.forEach((t) => freq.set(t, (freq.get(t) || 0) + 1)));
  const head = (it) => it.aiTags.reduce((a, t) => (freq.get(t) > freq.get(a) ? t : a), it.aiTags[0]);
  const sorted = list.map((it) => [it.id, head(it)]).sort((a, b) => freq.get(b[1]) - freq.get(a[1]) || a[1].localeCompare(b[1]));
  return new Map(sorted.map(([id], i) => [id, i]));
}

/* ---------- AI tags (aitags.js) ---------- */
// the vocabulary's own vectors, made once per model and kept next to the library's
let words = null, tagging = false;
async function wordVectors() {
  if (words) return words;
  const file = absPath(`ai/${MODEL.id}.words-v${VOCAB_V}.bin`);
  try {
    const buf = await fs.readFile(file);
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    if (all.length === VOCAB.length * MODEL.dim) return (words = VOCAB.map((_, i) => all.slice(i * MODEL.dim, (i + 1) * MODEL.dim)));
  } catch (e) { /* first time */ }
  const out = [];
  for (const w of VOCAB) { out.push((await call({ type: 'text', text: w })).vec); AI.tagging = out.length; AI.tagTotal = VOCAB.length; emit(); }
  const all = new Float32Array(VOCAB.length * MODEL.dim);
  out.forEach((v, i) => all.set(v, i * MODEL.dim));
  try { await fs.mkdir(absPath('ai'), { recursive: true }); await fs.writeFile(file, new Uint8Array(all.buffer)); } catch (e) { /* kept in memory */ }
  return (words = out);
}
const real = (v) => v && v.some((x) => x !== 0);
async function tagAll() {
  if (tagging || !prefs.on || cloud()) return; // through the API Claude chooses the tags
  const todo = S.items.filter((it) => !it.trashed && it.aiTagsV !== VOCAB_V && real(vecs.get(it.id)));
  if (!todo.length) return;
  tagging = true;
  try {
    AI.phase = 'words'; AI.tagging = 0; AI.tagTotal = VOCAB.length; emit();
    const W = await wordVectors();
    AI.phase = 'tags';
    const stats = wordStats(W, [...vecs.values()].filter(real));
    AI.tagTotal = todo.length;
    todo.forEach((it, n) => {
      it.aiTags = tagsFor(vecs.get(it.id), W, stats, it.aiNo || []).filter((t) => !it.tags.includes(t));
      it.aiTagsV = VOCAB_V;
      AI.tagging = n + 1;
    });
    AI.tagged = todo.filter((it) => it.aiTags.length).length;
    saveIndex();
    ui.refresh();
  } catch (e) { note('tags', e); } finally { tagging = false; AI.phase = ''; AI.tagging = 0; AI.tagTotal = 0; emit(); }
}
// new files, a new library: study what is missing
export function aiKick() {
  if (!prefs.on || AI.status !== 'ready') return;
  if (loadedRoot !== libKey()) { loadVectors().then(() => { emit(); study(); }); return; }
  study();
}

export function setPaused(p) {
  AI.paused = prefs.paused = p;
  keepPrefs();
  emit();
  if (!p) study();
}

/* ---------- on / off ---------- */
function fail(msg) { AI.status = 'error'; AI.error = msg; emit(); }

// one start at a time: quick off/on clicks used to start the model ten times at once and run out of memory
let starting = null, gen = 0; // gen: bumped by turnOff, so a start that was cut off knows it
export function turnOn() {
  prefs.on = true; keepPrefs();
  if (AI.status === 'ready') return Promise.resolve();
  return (starting ||= start().finally(() => { starting = null; }));
}
async function start() {
  if (AI.status === 'ready') return;
  const my = gen;
  AI.error = '';
  try {
    if (cloud()) {
      if (!C.claudeKey() && !C.hasVoyage()) throw new Error('нужен ключ Anthropic или Voyage — Настройки › «ИИ»');
      AI.device = 'api';
      await loadVectors();
      if (my !== gen) throw new Error('выключено');
      recount();
      AI.status = 'ready'; emit();
      study();
      if (S.q.trim()) ui.refresh();
      return;
    }
    const urls = await modelUrls();
    if (my !== gen) throw new Error('выключено');
    AI.status = 'loading'; emit();
    if (!worker) startWorker();
    const r = await call({ type: 'init', urls, gpu: true });
    if (my !== gen) throw new Error('выключено');
    AI.device = r.device;
    await loadVectors();
    recount();
    AI.status = 'ready'; emit();
    study();
    if (S.q.trim()) ui.refresh();
  } catch (e) {
    if (my !== gen) { // switched off while starting: not an error; switched on again meanwhile — start afresh
      AI.status = 'off'; emit();
      if (prefs.on) return start();
      return;
    }
    fail((e && e.message) || String(e));
  }
}
export async function turnOff() {
  prefs.on = false; keepPrefs();
  if (dlAbort) dlAbort.abort(); // a download in progress stops (its .part stays for a later resume)
  gen++;
  // what was waiting for the worker fails now, so a start in progress ends instead of hanging
  if (worker) { worker.terminate('ИИ выключен'); worker = null; }
  AI.status = 'off'; AI.confirm = null; emit();
  S.aiScores = null; S.aiQ = '';
  ui.refresh();
}
export function initAi() { if (prefs.on) turnOn(); }

/* ---------- search ---------- */
// the scores for the current search phrase arrive asynchronously; filter.js uses them only while they
// belong to the phrase in the box (S.aiQ === S.q)
let asking = '', askT = null;
const qCache = new Map(); // phrase → vector (both engines), the last 60: typing back and repeating is instant
async function phraseVec(q) {
  const k = (cloud() ? 'api:' : 'local:') + q.toLowerCase();
  if (qCache.has(k)) { const v = qCache.get(k); qCache.delete(k); qCache.set(k, v); return v; }
  const vec = cloud() ? await C.embedText(q) : (await call({ type: 'text', text: q })).vec;
  qCache.set(k, vec);
  if (qCache.size > 60) qCache.delete(qCache.keys().next().value);
  return vec;
}
export function aiSearch(q) {
  q = q.trim();
  if (!q || AI.status !== 'ready' || q === S.aiQ || q === asking) return;
  if (cloud() && !C.hasVoyage()) return; // API without Voyage: the search goes by Claude's descriptions (filter.js)
  clearTimeout(askT);
  askT = setTimeout(async () => {
    asking = q;
    AI.searching = true; emit();
    try {
      const vec = await phraseVec(q);
      if (S.q.trim() !== q) return;
      const scores = new Map();
      for (const [id, v] of vecs) {
        let s = 0;
        for (let k = 0; k < v.length; k++) s += v[k] * vec[k];
        scores.set(id, s);
      }
      S.aiScores = scores; S.aiQ = q; S.aiMin = semMin(scores);
      ui.refresh();
    } catch (e) { note('search', e); } finally { asking = ''; AI.searching = false; emit(); }
  }, qCache.has((cloud() ? 'api:' : 'local:') + q.toLowerCase()) ? 0 : 120);
}

// the same search by meaning for a caller that is not the search box (MCP, mcp.js): scores and the cut-off, S untouched;
// null when the AI cannot answer (off, still learning, the API without Voyage)
export async function scoreText(q) {
  q = String(q || '').trim();
  if (!q || AI.status !== 'ready' || (cloud() && !C.hasVoyage())) return null;
  const vec = await phraseVec(q);
  const scores = new Map();
  for (const [id, v] of vecs) {
    let s = 0;
    for (let k = 0; k < v.length; k++) s += v[k] * vec[k];
    scores.set(id, s);
  }
  return { scores, min: semMin(scores) };
}

/* ---------- «Проверить ИИ» (Settings) ---------- */
// one honest answer for «does it work?»: the engine and device, how much is studied, a test phrase turned into a
// vector and matched against the library (how long it took, how close the best picture is), the last error
export async function selfTest() {
  const out = { engine: prefs.engine, on: prefs.on, status: AI.status, device: AI.device, done: AI.done, total: AI.done + AI.todo,
    vectors: [...vecs.values()].filter(real).length, tagged: S.items.filter((i) => i.aiTags && i.aiTags.length).length,
    described: S.items.filter((i) => i.aiDesc).length, failed: AI.failed, ms: 0, best: null, bestName: '', error: AI.error || (AI.lastError ? AI.lastError.msg : '') };
  if (AI.status !== 'ready') return out;
  if (cloud() && !C.hasVoyage()) return out; // the search goes by descriptions: nothing to time
  try {
    const t0 = performance.now();
    const vec = cloud() ? await C.embedText('предмет на фоне') : (await call({ type: 'text', text: 'предмет на фоне' })).vec;
    out.ms = Math.round(performance.now() - t0);
    let best = -2, id = '';
    for (const [k, v] of vecs) { let d = 0; for (let j = 0; j < v.length; j++) d += v[j] * vec[j]; if (d > best) { best = d; id = k; } }
    if (id) { out.best = Math.round(best * 1000) / 1000; out.bestName = (S.byId.get(id) || {}).name || ''; }
  } catch (e) { out.error = (e && e.message) || String(e); note('search', e); }
  return out;
}

/* ---------- «Ещё похожие» and «Разобрать» (#80) ---------- */
const dotAll = (a, b) => { let s = 0; for (let j = 0; j < a.length; j++) s += a[j] * b[j]; return s; };
// the pictures closest in meaning to one, best first: [{ id, s }] — null when this one has no vector yet
export function nearestTo(id, n = 60) {
  const v = vecs.get(id);
  if (!real(v)) return null;
  const out = [];
  for (const [k, w] of vecs) {
    if (k === id || !real(w)) continue;
    const it = S.byId.get(k);
    if (!it || it.trashed) continue;
    out.push({ id: k, s: dotAll(v, w) });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, n);
}
// For files in no collection: the collection whose pictures they look like most. Each collection (≥ 3 studied files)
// is the mean of its vectors; a file gets a suggestion when it is about as close to that mean as the collection's own
// members are (not below their mean − one deviation) and clearly closer than to the runner-up.
// → Map id → { folder, score: 0..1 }
export function suggestFolders(ids) {
  const out = new Map();
  const groups = new Map();
  for (const it of S.items) {
    if (it.trashed || !it.folders || !it.folders.length) continue;
    const v = vecs.get(it.id);
    if (!real(v)) continue;
    for (const f of it.folders) { if (!groups.has(f)) groups.set(f, []); groups.get(f).push(v); }
  }
  const cents = [];
  for (const [f, vs] of groups) {
    if (vs.length < 3) continue;
    const c = new Float32Array(vs[0].length);
    for (const v of vs) for (let j = 0; j < c.length; j++) c[j] += v[j];
    let l = 0; for (let j = 0; j < c.length; j++) l += c[j] * c[j]; l = Math.sqrt(l) || 1;
    for (let j = 0; j < c.length; j++) c[j] /= l;
    const own = vs.map((v) => dotAll(v, c)), mean = own.reduce((a, b) => a + b, 0) / own.length;
    const sd = Math.sqrt(own.reduce((a, b) => a + (b - mean) ** 2, 0) / own.length);
    cents.push({ f, c, floor: mean - sd, mean });
  }
  if (!cents.length) return out;
  for (const id of ids) {
    const v = vecs.get(id);
    if (!real(v)) continue;
    const sc = cents.map((g) => ({ g, s: dotAll(v, g.c) })).sort((a, b) => b.s - a.s);
    const [a, b] = sc;
    if (a.s < a.g.floor) continue;
    if (b && a.s - b.s < 0.01) continue;
    out.set(id, { folder: a.g.f, score: Math.max(0, Math.min(1, (a.s - a.g.floor) / Math.max(1e-6, a.g.mean - a.g.floor) * 0.5 + 0.5)) });
  }
  return out;
}

// «По вкусу» in the feed: how close a picture from outside is to the library — the mean closeness to its 8 nearest
// studied pictures. Local engine only (the vector comes from the same model as the library's). → number or null
export async function tasteOf(blob) {
  if (AI.status !== 'ready' || cloud() || !worker) return null;
  const bmp = await createImageBitmap(blob);
  const { vec } = await call({ type: 'image', bitmap: bmp }, [bmp]);
  const sims = [];
  for (const v of vecs.values()) if (real(v)) sims.push(dotAll(vec, v));
  if (sims.length < 8) return null;
  sims.sort((a, b) => b - a);
  let m = 0; for (let i = 0; i < 8; i++) m += sims[i];
  return m / 8;
}
