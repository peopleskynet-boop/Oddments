// «Занято»: one library folder, one writer. Oddments Web (a browser tab) and the desktop app can open the same folder;
// whoever opened it first holds the mark — a small file in the folder, refreshed while it works — and the other one
// only looks (library.js readOnly, the strip of ui/rolock.js). A mark nobody refreshed for STALE_MS is free again
// (a closed tab, a crash). Plain plugin-fs, no Rust: the same in both builds.
import * as fs from '@tauri-apps/plugin-fs';

export const LOCK_FILE = 'oddments-lock.json';
export const STALE_MS = 3 * 60 * 1000; // a hidden tab's timers may fire once a minute (Chrome): three beats of slack
export const BEAT_MS = 30 * 1000;

// what the mark says for this window: 'free' (none, broken, or not refreshed for too long), 'mine', 'busy' (someone else)
export function lockState(lock, me, now = Date.now()) {
  if (!lock || typeof lock !== 'object' || !lock.id) return 'free';
  if (lock.id === me) return 'mine';
  const at = +lock.at || 0;
  return Math.abs(now - at) < STALE_MS ? 'busy' : 'free';
}

// who holds it, in the words of the strip
export function holderText(lock) {
  if (!lock) return '';
  return lock.app === 'web' ? `в другой вкладке или браузере (${lock.name || 'Oddments Web'})` : 'в настольном Oddments';
}

let me = '', path = '', app = 'desktop', label = '', beat = 0, onLost = null, held = false, local = false;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

// this window's id: kept through a reload of the same tab (sessionStorage), so a reload does not lock itself out;
// a copied tab (the browser copies sessionStorage) finds the id taken by a live tab and makes its own (BroadcastChannel)
async function windowId() {
  let id = '';
  try { id = sessionStorage.getItem('odd.lockId') || ''; } catch (e) { /* private mode */ }
  if (id && typeof BroadcastChannel === 'function') {
    const ch = new BroadcastChannel('oddments-lock');
    const taken = await new Promise((res) => {
      const t = setTimeout(() => res(false), 150);
      ch.onmessage = (m) => { if (m.data && m.data.taken === id) { clearTimeout(t); res(true); } };
      ch.postMessage({ who: id });
    });
    ch.close();
    if (taken) id = '';
  }
  if (!id) id = newId();
  try { sessionStorage.setItem('odd.lockId', id); } catch (e) { /* private mode */ }
  if (typeof BroadcastChannel === 'function') {
    const ch = new BroadcastChannel('oddments-lock');
    ch.onmessage = (m) => { if (m.data && m.data.who === me) ch.postMessage({ taken: me }); };
  }
  return id;
}

// is a tab with this id open in this browser? (every tab answers for its own id — windowId's channel)
function alive(id) {
  if (typeof BroadcastChannel !== 'function') return Promise.resolve(true);
  const ch = new BroadcastChannel('oddments-lock');
  return new Promise((res) => {
    const t = setTimeout(() => { ch.close(); res(false); }, 400);
    ch.onmessage = (m) => { if (m.data && m.data.taken === id) { clearTimeout(t); ch.close(); res(true); } };
    ch.postMessage({ who: id });
  });
}
// the mark of a tab of this browser that is gone (closed without taking it off, a crash): free at once. Only for a
// library the browser keeps itself (opts.local: OPFS) — there the holder can only be a tab of this browser; a folder on
// disk may be held by another browser or the desktop app, which this channel does not reach.
async function busy(lock) {
  if (lockState(lock, me) !== 'busy') return false;
  if (local && lock.app === 'web' && !(await alive(lock.id))) return false;
  return true;
}

async function readLock() {
  try { return JSON.parse(await fs.readTextFile(path)); } catch (e) { return null; }
}
const write = () => fs.writeTextFile(path, JSON.stringify({ app, id: me, name: label, at: Date.now() }));

// Take the folder: { held: true } or { held: false, lock } (someone else works in it). file: the mark's full path
// (library.js absPath(LOCK_FILE)); opts: app 'web' | 'desktop', name (what the other one shows), lost (called when
// someone took the mark from under this window while it held it), local (see busy above).
export async function takeLock(file, opts = {}) {
  path = file;
  app = opts.app || 'desktop'; label = opts.name || ''; onLost = opts.lost || null; local = !!opts.local;
  if (!me) me = await windowId();
  const lock = await readLock();
  if (await busy(lock)) return { held: false, lock };
  try { await write(); } catch (e) { console.warn('[lock] write', e); return { held: true, weak: true }; } // a folder we cannot write: nobody else could either
  // two windows opening at the same moment: the last write wins, the other one sees it and only looks
  await new Promise((r) => setTimeout(r, 250));
  const after = await readLock();
  if (after && after.id !== me && lockState(after, me) === 'busy') return { held: false, lock: after };
  held = true;
  clearInterval(beat);
  beat = setInterval(refresh, BEAT_MS);
  return { held: true };
}

async function refresh() {
  if (!held) return;
  const lock = await readLock();
  if (lock && lock.id !== me && lockState(lock, me) === 'busy') { held = false; clearInterval(beat); if (onLost) onLost(lock); return; }
  try { await write(); } catch (e) { /* the next beat */ }
}

// the window closes, or the library changes: the mark goes. now: the page is unloading — the removal is sent at once,
// without reading the mark first (a closing tab would not finish two steps); a mark left behind goes stale by itself.
export async function releaseLock(now = false) {
  if (!held) return;
  held = false;
  clearInterval(beat);
  try {
    if (now) { await fs.remove(path); return; }
    const lock = await readLock();
    if (lock && lock.id === me) await fs.remove(path);
  } catch (e) { /* stale soon */ }
}

// is the folder free now? (the looking window checks now and then; ui/rolock.js)
export async function lockFree() { return !(await busy(await readLock())); }
