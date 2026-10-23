// Blender bridge (frontend side): .blend and Alembic files are exported to GLB by the user's own
// Blender, run in the background by the Rust commands in src-tauri/src/blender.rs. The GLB is kept
// next to the original (files/<id>/scene.glb) and opened in the regular 3D viewer; the card gets a
// real render instead of the 128px embedded preview.
import { invoke } from '@tauri-apps/api/core';
import * as fs from '@tauri-apps/plugin-fs';
import { ui } from '../state.js';
import { absPath, saveIndex } from './library.js';
import { toBlob } from './ingest.js';
import { extractPalette, PALETTE_V } from './palette.js';
import { settings } from '../ui/settings.js';
import { busy, busyDone } from '../ui/dialogs.js';

export const viaBlender = (it) => it.kind === 'model' && (it.ext === 'blend' || it.ext === 'abc');
const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

let found; // undefined: not searched yet
export async function blenderPath() {
  if (settings.blenderPath) return settings.blenderPath;
  if (found === undefined) {
    try { found = inApp() ? await invoke('find_blender') : null; } catch (e) { found = null; }
  }
  return found || null;
}
export function forgetBlender() { found = undefined; }

const running = new Map();

// Exports one file to GLB (once; concurrent calls share the same run). Resolves to the GLB path.
export function prepare(it) {
  if (it.glb) return Promise.resolve(it.glb);
  if (running.has(it.id)) return running.get(it.id);
  const p = (async () => {
    if (!inApp()) throw new Error('Сцены Blender открываются в приложении для компьютера, в веб-версии — нет.');
    const exe = await blenderPath();
    if (!exe) throw new Error('Blender не найден. Укажите blender.exe в настройках, раздел «Blender».');
    const rel = `files/${it.id}/scene.glb`;
    await invoke('blender_to_glb', { blender: exe, input: absPath(it.file), output: absPath(rel) });
    it.glb = rel;
    await renderCard(it, rel).catch((e) => console.warn('scene thumbnail', e));
    saveIndex();
    ui.refresh();
    return rel;
  })().finally(() => running.delete(it.id));
  running.set(it.id, p);
  return p;
}

// a real render of the exported scene replaces the small embedded preview on the card
async function renderCard(it, rel) {
  const { renderModelThumb } = await import('./model3d.js');
  const u8 = await fs.readFile(absPath(rel));
  const r = await renderModelThumb(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), 'glb', 640, 480);
  const blob = await toBlob(r.canvas);
  const trel = `files/${it.id}/thumb-scene.webp`; // new name: the old thumbnail URL may be cached
  await fs.writeFile(absPath(trel), new Uint8Array(await blob.arrayBuffer()));
  it.thumb = trel;
  it.ar = r.canvas.height / r.canvas.width;
  it.verts = r.verts; it.tris = r.tris;
  try { const p = extractPalette(r.colorSrc); it.colors = p.colors; it.shares = p.shares; it.palV = PALETTE_V; } catch (e) { /* keep old palette */ }
}

// After an import: prepare new .blend/.abc files one by one in the background, with progress.
export async function autoPrepare(items) {
  const list = items.filter((it) => viaBlender(it) && !it.glb);
  if (!list.length || !settings.blenderAuto || !inApp() || !(await blenderPath())) return;
  let done = 0;
  for (const it of list) {
    busy(list.length > 1 ? `Blender: сцена ${done + 1} из ${list.length} — «${it.name}»` : `Blender готовит сцену «${it.name}»…`, list.length > 1 ? done / list.length : -1);
    try { await prepare(it); } catch (e) { console.warn('blender', it.name, e); }
    done++;
  }
  busyDone(list.length > 1 ? `Сцены Blender готовы: ${done}` : 'Сцена Blender готова');
}
