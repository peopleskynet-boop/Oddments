// @tauri-apps/plugin-fs for Oddments Web: one file layer over a FileSystemDirectoryHandle — OPFS or the folder the
// person opened (lite-store.js), the same files the desktop app writes. Paths are '/'-joined:
//   /lib/…  the library (library.js roots it here in the lite build);
//   the rest (/picked/… from the file dialogs, /app/… of lite-path.js) lives in memory for the session.
// With no handle at all (a private window) the library lives in memory too.
// A shared link (lib/lite.js SHARE): the library is read from the link's address — /lib/… is <link>/lib/…, by fetch and
// by address; what the app would write stays in memory.
// convertFileSrc (lite-core.js) needs an address at once: the service worker answers …/__odd/fs/lib/… with the file
// this page reads (serveFiles below); without a worker the file is handed out as a blob: address when it is known here.
import { libDir } from './lite-store.js';
import { MIME } from '../state.js';
import { SHARE } from '../lib/lite.js';

export const LIB = '/lib';
const mem = new Map(); // path -> Blob (also the library, when there is no handle)
const memDirs = new Set(['/']);
const urls = new Map(); // path -> blob: address
const known = new Map(); // library path -> File, for the address without a worker

const norm = (p) => ('/' + String(p).replace(/\\/g, '/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
const leaf = (p) => p.slice(p.lastIndexOf('/') + 1);
const onDisk = (p) => !!libDir() && (p === LIB || p.startsWith(LIB + '/'));
const segs = (p) => p.slice(LIB.length).split('/').filter(Boolean);
const typeOf = (p) => { const e = (p.match(/\.([a-z0-9]+)$/i) || [])[1]; return (e && (MIME[e.toLowerCase()] || { webp: 'image/webp', json: 'application/json' }[e.toLowerCase()])) || ''; };

function notFound(p) { const e = new Error('Нет такого файла или папки: ' + p); e.code = 'ENOENT'; return e; }
// a shared link's file: its address, '' for anything else
const remote = (p) => (SHARE && p.startsWith(LIB + '/') ? SHARE + 'lib' + p.slice(LIB.length).split('/').map(encodeURIComponent).join('/') : '');
async function remoteHead(p) {
  const u = remote(p);
  if (!u) return null;
  try { const r = await fetch(u, { method: 'HEAD' }); return r.ok ? r : null; } catch (e) { return null; }
}
const missing = (e) => e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

async function dirAt(list, create = false) {
  let d = libDir();
  for (const s of list) d = await d.getDirectoryHandle(s, { create });
  return d;
}
async function fileAt(p, create = false) {
  const s = segs(p), n = s.pop();
  if (!n) throw notFound(p);
  return (await dirAt(s, create)).getFileHandle(n, { create });
}
// the entry at a path: { file } | { dir } | null
async function entry(p) {
  if (p === LIB) return { dir: libDir() };
  const s = segs(p), n = s.pop();
  let d;
  try { d = await dirAt(s); } catch (e) { if (missing(e)) return null; throw e; }
  try { return { file: await d.getFileHandle(n) }; } catch (e) { if (!missing(e)) throw e; }
  try { return { dir: await d.getDirectoryHandle(n) }; } catch (e) { if (!missing(e)) throw e; }
  return null;
}

function forget(p) {
  const u = urls.get(p);
  if (u) { URL.revokeObjectURL(u); urls.delete(p); }
  known.delete(p);
}

/* ---------- writing ---------- */
// Safari's main thread cannot write an OPFS file (no createWritable): a small worker writes it with a sync handle
let writer = null, wid = 0;
const waits = new Map();
function viaWorker(p, data) {
  if (!writer) {
    writer = new Worker(new URL('./lite-write.worker.js', import.meta.url), { type: 'module' });
    writer.onmessage = (m) => { const w = waits.get(m.data.id); if (w) { waits.delete(m.data.id); if (m.data.error) w.rej(new Error(m.data.error)); else w.res(); } };
  }
  return new Promise((res, rej) => { const id = ++wid; waits.set(id, { res, rej }); writer.postMessage({ id, path: ['Oddments Library', ...segs(p)], data }); });
}

async function put(p, data, append = false) {
  p = norm(p);
  forget(p);
  if (!onDisk(p)) {
    for (let d = parent(p); d !== '/' && !memDirs.has(d); d = parent(d)) memDirs.add(d);
    const blob = data instanceof Blob ? data : new Blob([data]);
    mem.set(p, append && mem.has(p) ? new Blob([mem.get(p), blob]) : blob);
    return;
  }
  const fh = await fileAt(p, true);
  if (typeof fh.createWritable !== 'function') {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const all = append ? new Blob([await (await fh.getFile()).arrayBuffer(), blob]) : blob;
    await viaWorker(p, await all.arrayBuffer());
    if (!swBase) known.set(p, await fh.getFile());
    return;
  }
  const w = await fh.createWritable({ keepExistingData: append });
  try {
    if (append) await w.seek((await fh.getFile()).size);
    await w.write(data);
    await w.close();
  } catch (e) { try { await w.abort(); } catch (e2) { /* gone */ } throw e; }
  if (!swBase) known.set(p, await fh.getFile()); // no worker: the new file's address comes from here
}

async function blobAt(p) {
  p = norm(p);
  if (!onDisk(p)) {
    const b = mem.get(p);
    if (b) return b;
    const u = remote(p);
    if (!u) throw notFound(p);
    const r = await fetch(u);
    if (!r.ok) throw notFound(p);
    return r.blob();
  }
  try { return await (await fileAt(p)).getFile(); } catch (e) { if (missing(e)) throw notFound(p); throw e; }
}

/* ---------- the plugin-fs functions the app uses ---------- */
export async function exists(p) {
  p = norm(p);
  if (!onDisk(p)) return mem.has(p) || memDirs.has(p) || !!(await remoteHead(p));
  return !!(await entry(p));
}
export async function mkdir(p) {
  p = norm(p);
  if (!onDisk(p)) { for (let d = p; d !== '/' && !memDirs.has(d); d = parent(d)) memDirs.add(d); return; }
  await dirAt(segs(p), true);
}
export async function readFile(p) { return new Uint8Array(await (await blobAt(p)).arrayBuffer()); }
export async function readTextFile(p) { return (await blobAt(p)).text(); }
export async function writeFile(p, data) { await put(p, data); }
export async function writeTextFile(p, text, opts) { await put(p, new Blob([text], { type: 'text/plain' }), !!(opts && opts.append)); }
export async function copyFile(a, b) { await put(b, await blobAt(a)); }
export async function rename(a, b) {
  a = norm(a); b = norm(b);
  if (onDisk(a) && onDisk(b) && parent(a) === parent(b)) {
    // a move in place keeps the write atomic where the browser can (index.json.tmp → index.json)
    try { const fh = await fileAt(a); if (typeof fh.move === 'function') { forget(a); forget(b); await fh.move(leaf(b)); return; } } catch (e) { if (missing(e)) throw notFound(a); }
  }
  await put(b, await blobAt(a));
  await remove(a);
}
export async function remove(p) {
  p = norm(p);
  for (const k of [...urls.keys()]) if (k === p || k.startsWith(p + '/')) forget(k);
  if (!onDisk(p)) {
    for (const k of [...mem.keys()]) if (k === p || k.startsWith(p + '/')) mem.delete(k);
    for (const k of [...memDirs]) if (k === p || k.startsWith(p + '/')) memDirs.delete(k);
    return;
  }
  const s = segs(p), n = s.pop();
  try { await (await dirAt(s)).removeEntry(n, { recursive: true }); } catch (e) { if (!missing(e)) throw e; }
}
export async function stat(p) {
  p = norm(p);
  if (!onDisk(p)) {
    const f = mem.get(p);
    if (f) return { isFile: true, isDirectory: false, size: f.size, mtime: null };
    if (memDirs.has(p)) return { isFile: false, isDirectory: true, size: 0, mtime: null };
    const r = await remoteHead(p);
    if (r) return { isFile: true, isDirectory: false, size: +(r.headers.get('content-length') || 0), mtime: null };
    throw notFound(p);
  }
  const e = await entry(p);
  if (!e) throw notFound(p);
  if (e.dir) return { isFile: false, isDirectory: true, size: 0, mtime: null };
  const f = await e.file.getFile();
  return { isFile: true, isDirectory: false, size: f.size, mtime: new Date(f.lastModified) };
}
export async function readDir(p) {
  p = norm(p);
  if (!onDisk(p)) {
    const out = new Map();
    const add = (k, isDirectory) => { if (parent(k) === p) out.set(k, { name: leaf(k), isDirectory, isFile: !isDirectory, isSymlink: false }); };
    mem.forEach((_, k) => add(k, false));
    memDirs.forEach((k) => k !== p && add(k, true));
    return [...out.values()];
  }
  const e = await entry(p);
  if (!e || !e.dir) throw notFound(p);
  const out = [];
  for await (const h of e.dir.values()) out.push({ name: h.name, isDirectory: h.kind === 'directory', isFile: h.kind === 'file', isSymlink: false });
  return out;
}
// a big file in pieces (library.js writeBlobToDisk): the pieces gather into one Blob and go down in one write
export async function open(p) {
  const parts = [];
  return {
    async write(chunk) { parts.push(chunk); return chunk.length; },
    async close() { await put(p, new Blob(parts)); },
  };
}

/* ---------- files picked in a dialog or dropped: kept in memory under a path (lite-dialog.js) ---------- */
export function keep(p, blob) { p = norm(p); for (let d = parent(p); d !== '/' && !memDirs.has(d); d = parent(d)) memDirs.add(d); mem.set(p, blob); forget(p); }
export const readBlob = blobAt;
export const mimeOf = typeOf;

/* ---------- addresses for <img>, <video>, CSS ---------- */
let swBase = '';
// the service worker answers …/__odd/fs/<path> (lite-sw.js); without it, blob: addresses of what is known here
export function useWorker(base) { swBase = base; }
export function fileUrl(path) {
  const p = norm(path);
  if (onDisk(p) && swBase) return swBase + p.split('/').map(encodeURIComponent).join('/');
  if (!onDisk(p) && !mem.has(p) && remote(p)) return remote(p);
  let u = urls.get(p);
  if (u) return u;
  const b = onDisk(p) ? known.get(p) : mem.get(p);
  if (!b) return '';
  u = URL.createObjectURL(onDisk(p) && !b.type ? new Blob([b], { type: typeOf(p) }) : b);
  urls.set(p, u);
  return u;
}
// no worker (it did not start): the library's files the wall shows are fetched ahead, so their addresses exist
export async function warm(paths) {
  if (swBase || !libDir()) return;
  let i = 0;
  const one = async () => { while (i < paths.length) { const p = norm(paths[i++]); if (known.has(p)) continue; try { known.set(p, await (await fileAt(p)).getFile()); } catch (e) { /* gone */ } } };
  await Promise.all(Array.from({ length: 8 }, one));
}

// the page's side of the worker's file addresses: it asks for a path, the file goes back (with its type for the reply)
export function serveFiles() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', async (m) => {
    const d = m.data, port = m.ports && m.ports[0];
    if (!d || d.type !== 'odd-fs' || !port) return;
    try { const blob = await blobAt(d.path); port.postMessage({ blob, type: typeOf(d.path) || blob.type }); }
    catch (e) { port.postMessage({ blob: null }); }
  });
  navigator.serviceWorker.startMessages();
}
