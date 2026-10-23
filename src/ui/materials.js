// Materials in the library: «Материал из текстур…» (a set of maps or a zip from Poly Haven / ambientCG),
// zips with texture sets turn into .perchmat on any import, and the bits the 3D viewer needs to list, read and save.
import { S, ui } from '../state.js';
import { toast } from './dialogs.js';
import { absPath, addFromBlobs, assetUrl } from '../lib/library.js';
import { showQuickFile } from './quickfile.js';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import * as fs from '@tauri-apps/plugin-fs';

const MAT = () => import('../lib/material.js');
const isZip = (n) => /\.zip$/i.test(n);
const baseName = (p) => p.replace(/^.*[\\/]/, '');
const ctxFromView = () => { const v = S.view; return v.type === 'folder' ? { folder: v.id } : v.type === 'tag' ? { tag: v.id } : null; };

// zips that are texture sets become materials; everything else is imported as before
export async function splitPaths(paths) {
  const keep = [], blobs = [];
  for (const p of paths) {
    if (!isZip(p)) { keep.push(p); continue; }
    try {
      const st = await fs.stat(p);
      if (st.size > 600e6) { keep.push(p); continue; }
      const r = (await MAT()).fromZip(new Uint8Array(await fs.readFile(p)));
      if (r) blobs.push({ blob: r.blob, name: r.name + '.perchmat', source: '' }); else keep.push(p);
    } catch (e) { keep.push(p); }
  }
  return { paths: keep, blobs };
}
export async function splitBlobs(list) {
  const out = [];
  for (const e of list) {
    if (!isZip(e.name || '') || e.blob.size > 600e6) { out.push(e); continue; }
    try {
      const r = (await MAT()).fromZip(new Uint8Array(await e.blob.arrayBuffer()));
      out.push(r ? { blob: r.blob, name: r.name + '.perchmat', source: e.source || '' } : e);
    } catch (er) { out.push(e); }
  }
  return out;
}

// «Материал из текстур…»: pick the maps (or a zip); they are recognised by name and packed into one material
export async function pickTextures() {
  let r;
  try {
    r = await openDialog({ multiple: true, title: 'Текстуры материала или zip', filters: [{ name: 'Текстуры', extensions: ['png', 'jpg', 'jpeg', 'webp', 'tga', 'tif', 'tiff', 'exr', 'bmp', 'zip'] }] });
  } catch (e) { toast('Не удалось открыть окно выбора файлов. Перетащите zip с текстурами прямо в окно Oddments.'); return; }
  const paths = Array.isArray(r) ? r : r ? [r] : [];
  if (!paths.length) return;
  const M = await MAT();
  const blobs = [];
  const imgs = [];
  for (const p of paths) {
    try {
      const data = new Uint8Array(await fs.readFile(p));
      if (isZip(p)) { const z = M.fromZip(data); if (z) blobs.push({ blob: z.blob, name: z.name + '.perchmat', source: '' }); }
      else imgs.push({ name: baseName(p), data });
    } catch (e) { /* unreadable file: skipped */ }
  }
  if (imgs.length) {
    const m = M.recognise(imgs);
    if (m) blobs.push({ blob: M.pack(m), name: m.json.name + '.perchmat', source: '' });
  }
  if (!blobs.length) {
    toast('Не нашлось карт материала. Oddments узнаёт их по имени: …_diff / _basecolor, _nor_gl / _normal, _rough, _metal, _ao, _arm, _disp.', 8000);
    return;
  }
  const added = await addFromBlobs(blobs, ctxFromView());
  if (added.length) { ui.refresh(); showQuickFile(added); }
}

/* ---------- for the 3D viewer ---------- */
export const libraryMaterials = () => S.items.filter((i) => i.kind === 'material' && !i.trashed)
  .map((i) => ({ id: i.id, name: i.name, thumb: i.thumb ? assetUrl(i.thumb) : '' }));

export async function readItem(id) {
  const it = S.byId.get(id);
  const u8 = await fs.readFile(absPath(it.file));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// a file the viewer made (an edited material, a model with materials) goes next to its source
export async function saveFromViewer(blob, name, sourceId) {
  const src = sourceId && S.byId.get(sourceId);
  const ctx = src && src.folders && src.folders.length ? { folder: src.folders[0] } : ctxFromView();
  const added = await addFromBlobs([{ blob, name, source: '' }], ctx);
  if (added.length && src) added.forEach((it) => { it.tags = Array.from(new Set([...it.tags, ...src.tags])); });
  ui.refresh();
  return added;
}
