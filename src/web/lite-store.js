// Where the library of Oddments Web lives (lite-fs.js reads and writes through the handle given here):
//   'opfs'   — the browser's own storage (navigator.storage.getDirectory() › «Oddments Library»): the default;
//   'folder' — a folder on disk the person opened (Chrome, Edge: showDirectoryPicker) — the same index.json + files/ as
//              the desktop app, so both can use one folder (one at a time: lib/liblock.js);
//   'memory' — neither works (a private window): the library lives until the tab closes, the zip download keeps it.
// The choice is remembered: the folder's handle sits in IndexedDB, its permission is asked again on start (one click).
//   'share'  — a shared link (lib/lite.js SHARE): its library is read from the link's address, nothing is written.
import { SHARE } from '../lib/lite.js';

const DB = 'oddments-web', STORE = 'kv', OPFS_DIR = 'Oddments Library';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function kvGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  } catch (e) { return undefined; }
}
export async function kvSet(key, value) {
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (value === undefined) tx.objectStore(STORE).delete(key); else tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

let dir = null, mode = 'memory', name = '';
export const libDir = () => dir;
export const storeMode = () => mode;
export const storeName = () => name;
export const canPickFolder = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
export const hasOpfs = () => typeof navigator !== 'undefined' && !!(navigator.storage && navigator.storage.getDirectory);

async function opfsRoot() {
  const top = await navigator.storage.getDirectory();
  return top.getDirectoryHandle(OPFS_DIR, { create: true });
}

// the library the browser keeps; null when there is none (a private window)
async function useOpfs() {
  try { dir = await opfsRoot(); mode = 'opfs'; name = ''; return true; } catch (e) { console.warn('[lite] OPFS', e); return false; }
}

// Start: the remembered folder if its permission still holds, else what needs a click to go on — { ask: name } (the
// start card asks; ui/liteui.js), else the browser's own storage, else memory.
export async function openStore() {
  // a shared link: its library is read from its address (lite-fs.js), nothing of this browser's is opened
  if (SHARE) { mode = 'share'; dir = null; name = ''; return { mode }; }
  const saved = await kvGet('root');
  if (saved && saved.mode === 'folder' && saved.handle) {
    try {
      const p = await saved.handle.queryPermission({ mode: 'readwrite' });
      if (p === 'granted') { dir = saved.handle; mode = 'folder'; name = saved.handle.name; return { mode }; }
      if (p === 'prompt') return { ask: saved.handle.name, handle: saved.handle };
    } catch (e) { console.warn('[lite] folder', e); }
  }
  if (await useOpfs()) return { mode };
  mode = 'memory'; dir = null;
  return { mode };
}

// the click on the start card: the folder's permission again (a user gesture is needed for the prompt)
export async function grantFolder(handle) {
  const p = await handle.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') return false;
  dir = handle; mode = 'folder'; name = handle.name;
  return true;
}

// «Открыть папку библиотеки…»: the folder the person picks (null when the dialog was cancelled); rememberFolder makes it
// the library from the next start on
export async function pickFolder() {
  try { return await window.showDirectoryPicker({ id: 'oddments-library', mode: 'readwrite' }); } catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
}
export async function rememberFolder(h) { await kvSet('root', { mode: 'folder', handle: h }); }
// back to the library the browser keeps (from the next start on)
export async function forgetFolder() { await kvSet('root', undefined); }
// this start: the browser's library (the folder stays remembered — the next start asks again)
export async function openBrowserStore() { if (!(await useOpfs())) { mode = 'memory'; dir = null; } }

// the browser keeps the library even when the disk fills up (asked once there are files; Chrome decides by itself,
// Firefox asks the person)
let asked = false;
export async function keepStorage() {
  if (asked || mode !== 'opfs' || !navigator.storage || !navigator.storage.persist) return;
  asked = true;
  try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { /* not offered */ }
}
export async function storageInfo() {
  try {
    const [est, kept] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]);
    return { used: est.usage || 0, quota: est.quota || 0, kept };
  } catch (e) { return null; }
}

// the browser's own library, emptied (before a zip is opened in its place)
export async function clearOpfs() {
  const top = await navigator.storage.getDirectory();
  try { await top.removeEntry(OPFS_DIR, { recursive: true }); } catch (e) { /* nothing there */ }
  dir = await top.getDirectoryHandle(OPFS_DIR, { create: true });
  mode = 'opfs'; name = '';
}
