// Export (the night's list, item 11): a collection or the selected files — copies of the originals — into a folder
// you pick (a subfolder named after the collection), or into one .zip next to it. Names stay readable and unique
// («Постер.jpg», «Постер (2).jpg»); the library is not touched. zip: stored, not compressed (pictures and video are
// compressed already), built in memory — up to 1 GB, beyond that the folder way.
import * as fs from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { S } from '../state.js';
import { absPath } from './library.js';

const SEP = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform) ? '\\' : '/';
const clean = (n) => (n || 'Файл').replace(/[\\/:*?"<>|\u0000-\u001f‪-‮⁦-⁩]+/g, '_').trim().replace(/^\.+/, '').slice(0, 120) || 'Файл';

function names(items) {
  const used = new Set();
  return items.map((it) => {
    const ext = it.ext ? '.' + it.ext : '';
    const base = clean(it.name);
    let n = base + ext, k = 2;
    while (used.has(n.toLowerCase())) n = `${base} (${k++})${ext}`;
    used.add(n.toLowerCase());
    return n;
  });
}

// items of a collection, its sub-collections included
export function folderItems(fid) {
  const ids = new Set([fid]);
  let grew = true;
  while (grew) { grew = false; for (const f of S.folders) if (f.parent && ids.has(f.parent) && !ids.has(f.id)) { ids.add(f.id); grew = true; } }
  return S.items.filter((it) => !it.trashed && (it.folders || []).some((f) => ids.has(f)));
}

// the whole run with its progress and result, for menus and buttons
export async function runExport(items, title, asZip) {
  const { busy, busyDone, toast } = await import('../ui/dialogs.js');
  if (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__) { toast('Экспорт — в приложении Oddments'); return; }
  try {
    const r = await exportItems(items, title, asZip, (d, t) => busy(`Экспорт · ${d} из ${t}`, d / t));
    if (!r) return;
    busyDone(`Экспортировано: ${r.n}`);
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    toast(`Экспортировано: ${r.n}`, 6000, { label: 'Показать', fn: () => revealItemInDir(r.where).catch(() => {}) });
  } catch (e) { busyDone(''); toast('Экспорт не удался: ' + ((e && e.message) || e)); }
}

// → { n, where } or null when the dialog was cancelled; onProgress(done, total)
export async function exportItems(items, title, asZip = false, onProgress = () => {}) {
  const list = items.filter((it) => it && it.file && !it.trashed);
  if (!list.length) throw new Error('Нечего экспортировать');
  // recursive: the chosen folder (and what goes into it) joins the app's file access, as other dialog paths do
  const dir = await open({ directory: true, recursive: true, title: asZip ? 'Куда положить zip' : 'Куда скопировать' });
  if (!dir) return null;
  const nm = names(list), base = clean(title);
  if (asZip) {
    const total = list.reduce((a, it) => a + (it.size || 0), 0);
    if (total > 1e9) throw new Error('Больше 1 ГБ — экспортируйте в папку');
    const files = {};
    for (let i = 0; i < list.length; i++) { files[nm[i]] = [await fs.readFile(absPath(list[i].file)), { level: 0 }]; onProgress(i + 1, list.length); }
    let out = dir + SEP + base + '.zip', k = 2;
    while (await fs.exists(out)) out = `${dir}${SEP}${base} (${k++}).zip`;
    await fs.writeFile(out, zipSync(files));
    return { n: list.length, where: out };
  }
  let to = dir + SEP + base, k = 2;
  while (await fs.exists(to)) to = `${dir}${SEP}${base} (${k++})`;
  await fs.mkdir(to, { recursive: true });
  for (let i = 0; i < list.length; i++) { await fs.copyFile(absPath(list[i].file), to + SEP + nm[i]); onProgress(i + 1, list.length); }
  return { n: list.length, where: to };
}
