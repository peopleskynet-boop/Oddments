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
import { generate, toBlob } from './ingest.js';
import { extractPalette, PALETTE_V } from './palette.js';
import { placeholderName } from './linkmeta.js';
import { busy, busyDone } from '../ui/dialogs.js';
import { sfx } from '../ui/sound.js';
import { readText, writeText } from './prefs.js';
import { LITE, SHARE } from './lite.js';
import { takeLock, releaseLock, holderText, LOCK_FILE } from './liblock.js';

export const SEP = sep();
let root = '';
export const getRoot = () => root;
// a team library's file is «@<team id>/files/…»: it lives in that team's shared folder (team.js), not here
const teamRoots = new Map();
export const setTeamRoot = (id, dir) => { if (dir) teamRoots.set(id, dir); else teamRoots.delete(id); };
export const absPath = (rel) => {
  if (rel[0] === '@') { const k = rel.indexOf('/'), dir = teamRoots.get(rel.slice(1, k)); if (dir) return dir + SEP + rel.slice(k + 1).split('/').join(SEP); }
  return root + SEP + rel.split('/').join(SEP);
};

const urlCache = new Map();
export function assetUrl(rel) {
  let u = urlCache.get(rel);
  if (!u) { u = convertFileSrc(absPath(rel)); urlCache.set(rel, u); }
  return u;
}

export function reindex() {
  S.byId = new Map([...S.teamItems, ...S.items].map((i) => [i.id, i]));
}

// a type Oddments learned later (HDRI, TIFF, TGA — 15.11.2026): a file kept as «Другое» gets its kind at the start and
// its card and preview a little later, in the background (relearnKinds)
const relearn = [];
function migrate(it) {
  if (it.kind === 'other' && it.ext) { const k = kindOf(it.ext); if (k !== 'other') { it.kind = k; relearn.push(it); } }
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

// Documents/Oddments Library for a new library; a library made before the rename stays in «Perch Library» (nothing is
// moved: the person's files, the add-on's materials and other apps' links keep their paths)
async function defaultRoot() {
  const docs = await documentDir();
  const old = await join(docs, 'Perch Library');
  try { if (await fs.exists(old)) return old; } catch (e) { /* not readable: the new name */ }
  return join(docs, 'Oddments Library');
}

// «Только просмотр»: the folder is open in another Oddments (liblock.js) — nothing is written here until it is free
let readOnly = null, roSaid = 0;
export const isReadOnly = () => !!readOnly;
export const readOnlyLock = () => readOnly;
export function setReadOnly(lock) {
  readOnly = lock || { app: 'web' };
  if (typeof document !== 'undefined') document.body.classList.add('ro');
}
function roRefuse() {
  if (Date.now() - roSaid < 8000) return;
  roSaid = Date.now();
  ui.toast(readOnly.app === 'share' ? 'Это подборка по ссылке: её можно смотреть и скачивать, но не менять.' : `Только просмотр: библиотека открыта ${holderText(readOnly)}. Здесь изменения не сохраняются.`, 7000);
}
// the mark of this window on the folder (the lite build names the browser, the app — the computer)
const lockName = () => (LITE ? 'Oddments Web' + (typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent) ? ' · Firefox' : / Edg\//.test(navigator.userAgent) ? ' · Edge' : / Chrome\//.test(navigator.userAgent) ? ' · Chrome' : / Safari\//.test(navigator.userAgent) ? ' · Safari' : '') : 'Oddments');
export const releaseLibrary = (now = false) => releaseLock(now);

export async function initLibrary() {
  // Oddments Web: the library is the handle lite-store.js opened (OPFS or a folder on disk), mounted at /lib
  root = LITE ? '/lib' : readText('perch.root') || (await defaultRoot());
  await fs.mkdir(absPath('files'), { recursive: true });
  // a shared link (lite.js SHARE) is only looked at: no mark, nothing written
  if (SHARE) setReadOnly({ app: 'share' });
  else {
    // one folder, one writer: the first Oddments to open it holds the mark, the other one only looks
    const lk = await takeLock(absPath(LOCK_FILE), { app: LITE ? 'web' : 'desktop', name: lockName(), local: !!ui.lockLocal, lost: (l) => { setReadOnly(l); ui.readOnlyChanged && ui.readOnlyChanged(); } });
    if (!lk.held) setReadOnly(lk.lock);
  }
  const idx = absPath('index.json');
  let data = null, restored = '';
  if (await fs.exists(idx)) {
    try {
      data = await readIndex(idx);
      if (!readOnly) await keepBackups(data); // the one who works in the folder keeps its copies
    } catch (e) {
      // keep the broken file for a look later, open from the newest copy that reads, overwrite no backup
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (!readOnly) { try { await fs.copyFile(idx, absPath('index.json.broken-' + stamp)); } catch (e2) { /* ignore */ } }
      const tries = ['index.json.bak', ...(await dailyBackups()).map((n) => 'backups/' + n)];
      for (const t of tries) {
        try { data = await readIndex(absPath(t)); restored = t; break; } catch (e3) { /* next */ }
      }
      if (!data) throw new Error('Не удалось прочитать index.json в ' + root + ', и резервные копии тоже не читаются. Файлы на месте; index.json сохранён рядом как index.json.broken-' + stamp + '.');
      // the restored index becomes the current one right away, so a crash now cannot lose it
      if (!readOnly) { try { await fs.copyFile(absPath(restored), idx); } catch (e4) { /* the next save writes it */ } }
    }
  }
  S.folders = (data && data.folders) || [];
  S.items = ((data && data.items) || []).map(migrate);
  reindex();
  return { fresh: !data, restored, busy: readOnly };
}

export async function changeLibrary() {
  const dir = await openDialog({ directory: true, recursive: true, multiple: false, title: 'Папка библиотеки Oddments' });
  if (!dir) return;
  writeText('perch.root', dir);
  location.reload();
}

/* ---------- saving ---------- */
let saveTimer = null, dirty = false, chain = Promise.resolve();
let teamHook = null;
export const setTeamHook = (fn) => { teamHook = fn; };
export function saveIndex() {
  if (readOnly) { roRefuse(); return; }
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushIndex, 300);
}
export function flushIndex() {
  clearTimeout(saveTimer);
  chain = chain.then(async () => {
    if (!dirty || readOnly) return;
    dirty = false;
    if (teamHook) teamHook(); // edits to team items go to the person's journal in the team folder (team.js)
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
  await keepGenerated(it, await generate(it, src));
  S.items.push(it);
  S.byId.set(it.id, it);
}

// what ingest.js made for a file — size, colours, the card, the preview — onto the item and the disk. `fresh`: a card
// made again for a file that had one (a link's new cover) gets a new file name — the window would show the old picture
// from its cache — and the old one goes
async function keepGenerated(it, g, fresh = false) {
  it.w = g.w; it.h = g.h; it.ar = g.ar; it.duration = g.duration; it.pages = g.pages; it.colors = g.colors;
  if (g.shares) { it.shares = g.shares; it.palV = g.palV; } else if (fresh) { delete it.shares; delete it.palV; }
  if (g.verts) { it.verts = g.verts; it.tris = g.tris; } // optional, 3D only
  if (g.splats) it.splats = g.splats; // optional: how many splats a splat file holds
  if (g.thumb) {
    const rel = fresh ? `files/${it.id}/thumb-${Date.now().toString(36)}.webp` : `files/${it.id}/thumb.webp`;
    await fs.writeFile(absPath(rel), new Uint8Array(await g.thumb.arrayBuffer()));
    const old = it.thumb;
    it.thumb = rel;
    if (old && old !== rel && old.startsWith(`files/${it.id}/thumb`)) fs.remove(absPath(old)).catch(() => {});
  }
  if (g.preview) {
    await fs.writeFile(absPath(`files/${it.id}/preview.png`), new Uint8Array(await g.preview.arrayBuffer()));
    it.preview = `files/${it.id}/preview.png`;
  }
  if (it.kind === 'link' && 'page' in g) await keepPage(it, g);
}

// A link's page (ingest.js genLink): `it.page` { cover: 'page' | 'video' | 'own' | '', title, desc, site, host, tint,
// icon: the site's icon file, at } — an optional field. No `page` yet — the link is asked at the next start
// (refreshLinks). The person's own name stays; only an auto-made one («sketchfab.com», «YouTube abc») takes the title.
async function keepPage(it, g) {
  if (!g.page) { delete it.page; return; }
  const page = { ...g.page, icon: '', at: Date.now() };
  if (g.icon) {
    const rel = `files/${it.id}/icon.png`;
    try { await fs.writeFile(absPath(rel), new Uint8Array(await g.icon.arrayBuffer())); page.icon = rel; } catch (e) { /* no icon: the pill shows a letter */ }
  }
  it.page = page;
  if (page.title && placeholderName(it.name, 'https://' + page.host)) it.name = cleanName(page.title).slice(0, 200);
}

// what the AI and the text reader took from a link's old card (the grey card with the domain gave «Japanese text»,
// «logo» and «sketchfab.com Link»): dropped, they look at the new cover; the person's own tags and choices stay
function forgetPicture(it) {
  it.aiTags = []; delete it.aiTagsV; delete it.aiDesc; delete it.aiDescT;
  it.ocr = ''; delete it.ocrV; delete it.ocrT; delete it.pii; delete it.piiV;
}

// a file of the library as ingest.js reads it
const diskSrc = (it) => ({
  size: it.size,
  getBlob: async () => new Blob([await fs.readFile(absPath(it.file))], { type: MIME[it.ext] || '' }),
  url: () => assetUrl(it.file),
});

// Links read again: those made before covers (once, in the background at the start) or chosen in the menu. One at a
// time; `stop()` ends it between links, `step(done, total)` follows. Team files are the team's — not here.
export async function refreshLinks(list, { stop, step } = {}) {
  if (readOnly) return 0;
  const todo = list.filter((it) => it.kind === 'link' && !it.trashed && !it.team);
  let n = 0;
  for (const it of todo) {
    if (stop && stop()) break;
    try {
      const g = await generate(it, diskSrc(it));
      if (g.thumb && S.byId.get(it.id) === it) { forgetPicture(it); await keepGenerated(it, g, true); n++; }
    } catch (e) { console.warn('link', it.name, e); }
    if (step) step(n, todo.length, it);
  }
  return n;
}

// a picture the person chose as a link's cover (Ctrl+V onto a selected link, «Обложка из буфера»). Returns an undo:
// the old card file is kept until then (15 s)
export async function setLinkCover(it, blob) {
  if (readOnly) { roSaid = 0; roRefuse(); return null; }
  const { coverCanvas } = await import('./linkpage.js');
  const bmp = await createImageBitmap(blob);
  const c = coverCanvas(bmp);
  bmp.close();
  const rel = `files/${it.id}/thumb-${Date.now().toString(36)}.webp`;
  await fs.writeFile(absPath(rel), new Uint8Array(await (await toBlob(c)).arrayBuffer()));
  const prev = { thumb: it.thumb, w: it.w, h: it.h, ar: it.ar, colors: it.colors, shares: it.shares, palV: it.palV, page: it.page };
  forgetPicture(it);
  const p = extractPalette(c);
  Object.assign(it, { thumb: rel, w: c.width, h: c.height, ar: c.height / c.width, colors: p.colors, shares: p.shares, palV: PALETTE_V });
  it.page = { ...(it.page || { title: '', desc: '', site: '', host: '', tint: '', icon: '' }), cover: 'own', at: Date.now() };
  saveIndex();
  let undone = false;
  const old = prev.thumb;
  setTimeout(() => { if (!undone && old && old !== rel && old.startsWith(`files/${it.id}/thumb`)) fs.remove(absPath(old)).catch(() => {}); }, 15000);
  return () => {
    undone = true;
    Object.assign(it, prev);
    if (!prev.page) delete it.page;
    if (!prev.shares) { delete it.shares; delete it.palV; }
    fs.remove(absPath(rel)).catch(() => {});
    saveIndex();
  };
}

// the files that got a kind at the start (migrate): their cards and previews, one by one, in the background
export async function relearnKinds() {
  if (readOnly) return 0;
  const list = relearn.splice(0).filter((it) => !it.thumb && !it.trashed);
  let n = 0;
  for (const it of list) {
    try {
      await keepGenerated(it, await generate(it, diskSrc(it)));
      n++;
    } catch (e) { console.warn('relearn', it.name, e); }
  }
  if (n) { saveIndex(); ui.refresh(); }
  return n;
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
  if (readOnly) { roSaid = 0; roRefuse(); return []; }
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
    // an importer's own fields for this file (Eagle: name, tags, collections, note, link, date — importers.js)
    if (ctx && ctx.meta) Object.assign(it, ctx.meta(f.p));
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
  if (readOnly) { roSaid = 0; roRefuse(); return []; }
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
  if (readOnly) { roSaid = 0; roRefuse(); return; }
  const ids = new Set(items.map((i) => i.id));
  S.items = S.items.filter((i) => !ids.has(i.id));
  items.forEach((i) => S.sel.delete(i.id));
  reindex();
  saveIndex();
  for (const it of items) {
    try { await fs.remove(absPath(`files/${it.id}`), { recursive: true }); } catch (e) { console.warn(e); }
  }
}
