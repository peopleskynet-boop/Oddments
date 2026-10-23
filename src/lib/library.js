// Library on disk:
//   <root>/index.json                 folders + item metadata
//   <root>/files/<id>/<original name> the untouched original
//   <root>/files/<id>/thumb.webp      thumbnail used by the grid
//   <root>/files/<id>/preview.png     full-size render for PSD
import { sep, documentDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import * as fs from '@tauri-apps/plugin-fs';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { S, ui, kindOf, MIME, extFromMime } from '../state.js';
import { uid, baseName, splitName, safeFile } from '../util.js';
import { generate } from './ingest.js';
import { busy, busyDone } from '../ui/dialogs.js';
import { sfx } from '../ui/sound.js';

const SEP = sep();
let root = '';
export const getRoot = () => root;
export const absPath = (rel) => root + SEP + rel.split('/').join(SEP);

const urlCache = new Map();
export function assetUrl(rel) {
  let u = urlCache.get(rel);
  if (!u) { u = convertFileSrc(absPath(rel)); urlCache.set(rel, u); }
  return u;
}

export function reindex() {
  S.byId = new Map(S.items.map((i) => [i.id, i]));
}

function migrate(it) {
  delete it.rating; // ratings were removed
  it.tags = it.tags || [];
  it.folders = it.folders || [];
  it.note = it.note || '';
  it.url = it.url || '';
  it.colors = it.colors || [];
  it.ar = it.ar || 0.75;
  it.fresh = !!it.fresh; // added and not yet seen on screen
  it.fav = !!it.fav;
  return it;
}

// Loading index.json, carefully (bug #32: a corrupt index used to be copied over the only good backup).
// - index.json.bak is the last index that read fine; it is replaced only by an index that reads fine and is not
//   suspiciously empty (0 files while the backup had files: a bug or a half-written disk, not a choice).
// - backups/index-YYYY-MM-DD.json: one copy a day, the last 7 days, the same rule.
// - a corrupt index.json is kept aside as index.json.broken-<time> and never overwrites a backup; the library opens
//   from the newest copy that reads, and the window says so (initLibrary returns { restored }).
const BACKUP_DAYS = 7;
const readIndex = async (p) => { const d = JSON.parse(await fs.readTextFile(p)); if (!d || !Array.isArray(d.items)) throw new Error('не индекс'); return d; };
const count = (d) => (d && d.items ? d.items.filter((i) => !i.trashed).length : 0);
const today = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

async function dailyBackups() {
  try { return (await fs.readDir(absPath('backups'))).map((e) => e.name).filter((n) => /^index-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse(); } catch (e) { return []; }
}

async function keepBackups(data) {
  const n = count(data);
  // the last good backup: not replaced by an empty index when it had files
  let prev = null;
  try { prev = await readIndex(absPath('index.json.bak')); } catch (e) { /* none yet */ }
  if (!(n === 0 && count(prev) > 0)) { try { await fs.copyFile(absPath('index.json'), absPath('index.json.bak')); } catch (e) { /* ignore */ } }
  // one copy a day, the last BACKUP_DAYS
  try {
    await fs.mkdir(absPath('backups'), { recursive: true });
    const name = `index-${today()}.json`, list = await dailyBackups();
    if (!list.includes(name) && !(n === 0 && list.length)) await fs.copyFile(absPath('index.json'), absPath('backups/' + name));
    for (const old of (await dailyBackups()).slice(BACKUP_DAYS)) await fs.remove(absPath('backups/' + old)).catch(() => {});
  } catch (e) { /* backups are a safety net, never a reason not to open */ }
}

export async function initLibrary() {
  root = localStorage.getItem('perch.root') || (await join(await documentDir(), 'Perch Library'));
  await fs.mkdir(absPath('files'), { recursive: true });
  const idx = absPath('index.json');
  let data = null, restored = '';
  if (await fs.exists(idx)) {
    try {
      data = await readIndex(idx);
      await keepBackups(data);
    } catch (e) {
      // keep the broken file for a look later, open from the newest copy that reads, overwrite no backup
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try { await fs.copyFile(idx, absPath('index.json.broken-' + stamp)); } catch (e2) { /* ignore */ }
      const tries = ['index.json.bak', ...(await dailyBackups()).map((n) => 'backups/' + n)];
      for (const t of tries) {
        try { data = await readIndex(absPath(t)); restored = t; break; } catch (e3) { /* next */ }
      }
      if (!data) throw new Error('Не удалось прочитать index.json в ' + root + ', и резервные копии тоже не читаются. Файлы на месте; index.json сохранён рядом как index.json.broken-' + stamp + '.');
      // the restored index becomes the current one right away, so a crash now cannot lose it
      try { await fs.copyFile(absPath(restored), idx); } catch (e4) { /* the next save writes it */ }
    }
  }
  S.folders = (data && data.folders) || [];
  S.items = ((data && data.items) || []).map(migrate);
  reindex();
  return { fresh: !data, restored };
}

export async function changeLibrary() {
  const dir = await openDialog({ directory: true, recursive: true, multiple: false, title: 'Папка библиотеки Oddments' });
  if (!dir) return;
  localStorage.setItem('perch.root', dir);
  location.reload();
}

/* ---------- saving ---------- */
let saveTimer = null, dirty = false, chain = Promise.resolve();
export function saveIndex() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushIndex, 300);
}
export function flushIndex() {
  clearTimeout(saveTimer);
  chain = chain.then(async () => {
    if (!dirty) return;
    dirty = false;
    try {
      const json = JSON.stringify({ version: 1, folders: S.folders, items: S.items });
      const tmp = absPath('index.json.tmp');
      await fs.writeTextFile(tmp, json);
      await fs.rename(tmp, absPath('index.json'));
    } catch (e) {
      dirty = true;
      console.error(e);
      ui.toast('Не удалось сохранить библиотеку: ' + (e && e.message ? e.message : e));
    }
  });
  return chain;
}

/* ---------- adding files ---------- */
async function pool(tasks, n, onEach) {
  let i = 0, done = 0;
  async function worker() {
    while (i < tasks.length) {
      const my = i++;
      try { await tasks[my](); } catch (e) { console.error(e); }
      done++; onEach && onEach(done, tasks.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}

async function writeBlobToDisk(blob, path) {
  if (blob.size <= 16e6) { await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer())); return; }
  const h = await fs.open(path, { write: true, create: true, truncate: true });
  try {
    const rd = blob.stream().getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      await h.write(value);
    }
  } finally { await h.close(); }
}

// the view's tag, plus the tags the browser extension chose
const ctxTags = (ctx) => [...new Set([...(ctx && ctx.tag ? [ctx.tag] : []), ...((ctx && ctx.tags) || [])])];

// direction marks (U+202A–202E, U+2066–2069, LRM/RLM) let «photo‮gnp.exe» read as «photoexe.png» (audit #37)
const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
export const cleanName = (s) => String(s || '').replace(BIDI, '');

function newItem(fileName, size, ctx, mimeHint) {
  const { name, ext: rawExt } = splitName(cleanName(fileName));
  const ext = rawExt || extFromMime(mimeHint) || '';
  const id = uid();
  const safe = safeFile(name) + (ext ? '.' + ext : '');
  return {
    id, name: name || 'Без названия', ext, kind: kindOf(ext), size, added: Date.now(),
    file: `files/${id}/${safe}`, thumb: null, preview: null,
    w: 0, h: 0, ar: 0.75, duration: 0, pages: 0,
    tags: ctxTags(ctx), folders: ctx && ctx.folder ? [ctx.folder] : [],
    note: '', url: (ctx && ctx.url) || '', colors: [], trashed: false, fresh: true, fav: false,
  };
}

async function finalize(it, src) {
  const g = await generate(it, src);
  it.w = g.w; it.h = g.h; it.ar = g.ar; it.duration = g.duration; it.pages = g.pages; it.colors = g.colors; if (g.shares) { it.shares = g.shares; it.palV = g.palV; }
  if (g.verts) { it.verts = g.verts; it.tris = g.tris; } // optional, 3D only
  if (g.thumb) {
    await fs.writeFile(absPath(`files/${it.id}/thumb.webp`), new Uint8Array(await g.thumb.arrayBuffer()));
    it.thumb = `files/${it.id}/thumb.webp`;
  }
  if (g.preview) {
    await fs.writeFile(absPath(`files/${it.id}/preview.png`), new Uint8Array(await g.preview.arrayBuffer()));
    it.preview = `files/${it.id}/preview.png`;
  }
  S.items.push(it);
  S.byId.set(it.id, it);
}

// progress line: names the file being processed, so a slow PSD or video is visibly "working"
function blenderAfterImport(added) {
  if (added.some((i) => i.kind === 'model' && (i.ext === 'blend' || i.ext === 'abc'))) {
    // a moment later, so the "Добавлено" line is seen first
    setTimeout(() => import('./blender.js').then((m) => m.autoPrepare(added)), 1500);
  }
}

function progressFor(names) {
  const total = names.length;
  busy(total > 1 ? `Импорт: 0 из ${total}` : `Обрабатываю «${names[0]}»…`, total > 1 ? 0 : -1);
  return (done) => { if (total > 1) busy(`Импорт: ${done} из ${total}`, done / total); };
}

// pictures that did not open (broken or not really a picture) are kept, but the person is told which (audit #36)
function warnBad(added, empty) {
  const bad = added.filter((i) => (i.kind === 'image' || i.kind === 'gif') && !i.w);
  const parts = [];
  if (bad.length) parts.push(bad.length === 1 ? `«${bad[0].name}» не открылся как картинка — файл повреждён или это не картинка; он добавлен без превью` : `${bad.length} файлов не открылись как картинки — добавлены без превью`);
  if (empty) parts.push(`Пустых файлов пропущено: ${empty}`);
  if (parts.length) setTimeout(() => ui.toast(parts.join('. ') + '.', 9000), 600);
}

// Items from disk paths (file dialog, folder import).
export async function addFromPaths(paths, ctx) {
  const files = [];
  async function collect(p) {
    let st;
    try { st = await fs.stat(p); } catch (e) { return; }
    if (st.isDirectory) {
      for (const e of await fs.readDir(p)) if (!e.name.startsWith('.')) await collect(p + SEP + e.name);
    } else if (st.isFile) files.push({ p, size: st.size });
  }
  for (const p of paths) await collect(p);
  // empty files carry nothing to keep (audit #36)
  const empty = files.filter((f) => !f.size).length;
  files.splice(0, files.length, ...files.filter((f) => f.size));
  if (!files.length) { ui.toast(empty ? 'Файлы пустые (0 байт) — добавлять нечего' : 'В выбранном нет файлов, которые Oddments умеет хранить'); return []; }
  const added = [];
  const progress = progressFor(files.map((f) => baseName(f.p)));
  const tasks = files.map((f) => async () => {
    const it = newItem(baseName(f.p), f.size, ctx);
    await fs.mkdir(absPath(`files/${it.id}`), { recursive: true });
    await fs.copyFile(f.p, absPath(it.file));
    const mime = MIME[it.ext] || '';
    await finalize(it, {
      size: f.size,
      getBlob: async () => new Blob([await fs.readFile(absPath(it.file))], { type: mime }),
      url: () => assetUrl(it.file),
    });
    added.push(it);
    if (added.length % 6 === 0) ui.refresh();
  });
  await pool(tasks, 3, progress);
  saveIndex(); await flushIndex();
  ui.refresh();
  busyDone(`Добавлено: ${added.length}`);
  warnBad(added, empty);
  blenderAfterImport(added);
  return added;
}

// Items from Blobs/Files (clipboard, drag from browser, drag from Explorer).
export async function addFromBlobs(list, ctx) {
  const empty = list.filter((e) => !e.blob || !e.blob.size).length;
  list = list.filter((e) => e.blob && e.blob.size);
  if (!list.length) { if (empty) ui.toast('Файл пустой (0 байт) — добавлять нечего'); return []; }
  const added = [];
  const progress = progressFor(list.map((e) => e.name || 'картинка'));
  const tasks = list.map((entry) => async () => {
    const blob = entry.blob;
    const it = newItem(entry.name || 'image', blob.size, { ...ctx, url: entry.source || '' }, blob.type);
    await fs.mkdir(absPath(`files/${it.id}`), { recursive: true });
    await writeBlobToDisk(blob, absPath(it.file));
    await finalize(it, { size: blob.size, getBlob: async () => blob, url: () => assetUrl(it.file) });
    added.push(it);
    if (added.length % 6 === 0) ui.refresh();
  });
  await pool(tasks, 3, progress);
  saveIndex(); await flushIndex();
  ui.refresh();
  busyDone(`Добавлено: ${added.length}`);
  warnBad(added, empty);
  blenderAfterImport(added);
  return added;
}

/* ---------- trash / delete ---------- */
export function trashItems(items) {
  if (items.length) sfx('trash');
  items.forEach((i) => { i.trashed = true; });
  saveIndex();
}
export function restoreItems(items) {
  if (items.length) sfx('undo');
  items.forEach((i) => { i.trashed = false; });
  saveIndex();
}
export async function purgeItems(items) {
  const ids = new Set(items.map((i) => i.id));
  S.items = S.items.filter((i) => !ids.has(i.id));
  items.forEach((i) => S.sel.delete(i.id));
  reindex();
  saveIndex();
  for (const it of items) {
    try { await fs.remove(absPath(`files/${it.id}`), { recursive: true }); } catch (e) { console.warn(e); }
  }
}
