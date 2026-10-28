// In-memory file system for the browser build (`npm run web`). Paths use '/'.
// Everything lives in memory: a reload brings back the demo library from seed.js.
import { seed } from './seed.js';

const files = new Map(); // path -> Blob
const dirs = new Set(['/']);
const urls = new Map(); // path -> object URL

const norm = (p) => ('/' + String(p).replace(/\\/g, '/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';

function mkdirs(p) {
  for (let d = p; d !== '/' && !dirs.has(d); d = parent(d)) dirs.add(d);
}
function put(path, blob) {
  const p = norm(path);
  mkdirs(parent(p));
  files.set(p, blob);
  const u = urls.get(p);
  if (u) { URL.revokeObjectURL(u); urls.delete(p); }
}
function get(path) {
  const b = files.get(norm(path));
  if (!b) throw new Error('Файл не найден: ' + path);
  return b;
}

export const mem = { put, get, norm };

// Synchronous object URL for convertFileSrc().
export function urlFor(path) {
  const p = norm(path);
  let u = urls.get(p);
  if (!u && files.has(p)) { u = URL.createObjectURL(files.get(p)); urls.set(p, u); }
  return u || '';
}

let ready = null;
export const whenReady = () => (ready ||= seed(put));

export async function exists(p) { await whenReady(); p = norm(p); return files.has(p) || dirs.has(p); }
export async function mkdir(p) { await whenReady(); mkdirs(norm(p)); }
export async function readFile(p) { await whenReady(); return new Uint8Array(await get(p).arrayBuffer()); }
export async function readTextFile(p) { await whenReady(); return get(p).text(); }
export async function writeFile(p, data) { await whenReady(); put(p, new Blob([data])); }
export async function writeTextFile(p, text, opts) { await whenReady(); put(p, new Blob(opts && opts.append && files.has(norm(p)) ? [get(p), text] : [text], { type: 'text/plain' })); }
export async function copyFile(a, b) { await whenReady(); put(b, get(a)); }
export async function rename(a, b) { await whenReady(); put(b, get(a)); files.delete(norm(a)); }
export async function remove(p) {
  await whenReady();
  p = norm(p);
  for (const k of [...files.keys()]) if (k === p || k.startsWith(p + '/')) files.delete(k);
  for (const k of [...dirs]) if (k === p || k.startsWith(p + '/')) dirs.delete(k);
}
export async function stat(p) {
  await whenReady();
  p = norm(p);
  const f = files.get(p);
  if (f) return { isFile: true, isDirectory: false, size: f.size };
  if (dirs.has(p)) return { isFile: false, isDirectory: true, size: 0 };
  throw new Error('Нет такого пути: ' + p);
}
export async function readDir(p) {
  await whenReady();
  p = norm(p);
  const out = new Map();
  const add = (k, isDirectory) => {
    if (parent(k) === p) out.set(k, { name: k.slice(k.lastIndexOf('/') + 1), isDirectory, isFile: !isDirectory });
  };
  files.forEach((_, k) => add(k, false));
  dirs.forEach((k) => k !== p && add(k, true));
  return [...out.values()];
}
export async function open(p) {
  await whenReady();
  const parts = [];
  return {
    async write(chunk) { parts.push(chunk); return chunk.length; },
    async close() { put(p, new Blob(parts)); },
  };
}
