// Watch folders (the night's list, item 12): folders you choose — Downloads, Screenshots, an export folder — are looked
// into every few seconds; a new picture, video, model… is copied into the library the usual way (with the «куда
// положить» pill), the original stays where it is. Only files that appear after the folder was added count, and a file
// is taken once its size has stopped changing (a download still being written is left for the next look). Polling, not
// a system watcher: no new Rust, and a few readDir calls every 5 s cost nothing. Folders come from the dialog
// (recursive: true — the app may read them, and the access is remembered).
import * as fs from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { KINDS } from '../state.js';

const KEY = 'perch.watch';
const EVERY = 5000;
const SEP = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform) ? '\\' : '/';
let timer = null, importer = null;
const pending = new Map(); // path → size at the last look (not taken until it is the same twice)

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{"dirs":[]}'); } catch (e) { return { dirs: [] }; } };
const keep = (st) => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* private mode */ } };
export const watchedDirs = () => load().dirs.map((d) => d.path);

const known = new Set(Object.values(KINDS).flatMap((k) => k.ext || []).map((e) => e.toLowerCase()));
const wanted = (name) => { const m = /\.([^.]+)$/.exec(name); return !!m && known.has(m[1].toLowerCase()) && !name.startsWith('~$') && !/\.(crdownload|part|tmp|download)$/i.test(name); };

async function listing(dir) {
  const out = [];
  for (const e of await fs.readDir(dir)) if (e.isFile && wanted(e.name)) out.push(e.name);
  return out;
}

export async function addWatchDir() {
  const dir = await open({ directory: true, recursive: true, title: 'Какую папку смотреть' });
  if (!dir) return null;
  const st = load();
  if (st.dirs.some((d) => d.path === dir)) return dir;
  // what is already there is not new: only what appears from now on
  let seen = [];
  try { seen = await listing(dir); } catch (e) { /* unreadable now: everything found later counts as new */ }
  st.dirs.push({ path: dir, seen });
  keep(st);
  start();
  return dir;
}
export function removeWatchDir(path) {
  const st = load();
  st.dirs = st.dirs.filter((d) => d.path !== path);
  keep(st);
  if (!st.dirs.length) stop();
}

// one look now (for tests)
export async function lookNow() { return look(); }
async function look() {
  const st = load();
  if (!st.dirs.length || !importer) return;
  let changed = false;
  const take = [];
  for (const d of st.dirs) {
    let names;
    try { names = await listing(d.path); } catch (e) { continue; } // the folder is gone or not reachable now
    const seen = new Set(d.seen);
    for (const n of names) {
      if (seen.has(n)) continue;
      const p = d.path + SEP + n;
      let size = -1;
      try { size = (await fs.stat(p)).size; } catch (e) { continue; }
      if (size > 0 && pending.get(p) === size) { take.push(p); pending.delete(p); seen.add(n); changed = true; }
      else pending.set(p, size);
    }
    // forget names that left the folder, so a file saved again under the same name is new again
    const now = new Set(names);
    const kept = [...seen].filter((n) => now.has(n));
    if (kept.length !== d.seen.length || changed) { d.seen = kept; changed = true; }
  }
  if (changed) keep(st);
  if (take.length) {
    try { await importer(take); } catch (e) { console.warn('watch import failed', e); }
  }
}

function start() {
  if (timer || !load().dirs.length) return;
  timer = setInterval(look, EVERY); // also while hidden in the tray: a screenshot taken meanwhile is in the library
}
function stop() { clearInterval(timer); timer = null; }

// importPaths(paths): the app's own import (main.js addPaths)
export function initWatch(importPaths) {
  if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) return;
  importer = importPaths;
  start();
}
