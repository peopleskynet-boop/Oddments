// «В Blender»: files go to the add-on's queue (bridge /outbox); Blender with the Oddments add-on 1.2+ picks them up
// within a second — models land in the scene, a .perchmat goes onto the selected objects.
import { toast } from './dialogs.js';
import { sendToBlender } from '../lib/bridge.js';
import { sfx } from './sound.js';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import * as fs from '@tauri-apps/plugin-fs';

export async function toBlender(paths, what) {
  const r = await sendToBlender(paths);
  if (r === 'web') { toast('В веб-версии нет связи с Blender — это работает в приложении Oddments.'); return; }
  sfx('done');
  if (r === 'sent') toast(`${what || 'Файлы'} — в Blender`);
  else toast('Отправлено. Blender заберёт, когда будет открыт с аддоном Oddments 1.2 и включённым «Принимать из Oddments» (аддон — в Настройках › Интеграции).', 9000);
}

// a file made on the fly (the SVG → 3D result, a splat made or converted here) that is not in the library: written to the
// app's outbox folder first
async function outboxFile(data, fileName) {
  const dir = await join(await appLocalDataDir(), 'outbox');
  await fs.mkdir(dir, { recursive: true });
  const path = await join(dir, fileName.replace(/[\\/:*?"<>|]/g, '_'));
  if (typeof data === 'string') await fs.writeTextFile(path, data); else await fs.writeFile(path, data);
  return path;
}
const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
export async function textToBlender(text, fileName, what) {
  if (!inApp()) return toBlender([], what);
  try { await toBlender([await outboxFile(text, fileName)], what); } catch (e) { toast('Не удалось отправить в Blender: ' + (e && e.message ? e.message : e)); }
}
export async function bytesToBlender(bytes, fileName, what) {
  if (!inApp()) return toBlender([], what);
  try { await toBlender([await outboxFile(bytes, fileName)], what); } catch (e) { toast('Не удалось отправить в Blender: ' + (e && e.message ? e.message : e)); }
}

// library files go as they are; a splat in a format Blender does not read (.splat, .ksplat, .sog) goes as PLY
export async function itemsToBlender(items) {
  const [{ absPath }, { isSplatItem }] = await Promise.all([import('../lib/library.js'), import('../state.js')]);
  const paths = [];
  try {
    for (const it of items) {
      if (inApp() && isSplatItem(it) && !['ply', 'spz'].includes(it.ext)) {
        const { splatToPly } = await import('../lib/splat.js');
        paths.push(await outboxFile(await splatToPly(await fs.readFile(absPath(it.file)), it.ext, it.name), it.name + '.ply'));
      } else paths.push(absPath(it.file));
    }
  } catch (e) { toast('Не удалось подготовить сплат для Blender: ' + (e && e.message ? e.message : e)); return; }
  await toBlender(paths, items.length === 1 ? items[0].name : 'Файлы: ' + items.length);
}

// «Набор в Blender»: several SVGs become one icon set — every icon built in its own frame (viewBox) with the style of
// the «SVG в 3D» window, so they share size and depth; the add-on (1.16+) lays them out in «Icons · <set>», keeps the
// source of each (its «Обновить» and style values re-make them in Blender) and gives each part its material slot.
export async function iconSetToBlender(items, setName) {
  const svgs = items.filter((it) => it.ext === 'svg' && !it.trashed);
  if (!svgs.length) return;
  const [{ meshForAddon }, { readPref }, { absPath }] = await Promise.all([import('../lib/meshjob.js'), import('../lib/prefs.js'), import('../lib/library.js')]);
  const style = readPref('perch.svg3d', {});
  const icons = [], skipped = [];
  for (const it of svgs) {
    try {
      const r = await meshForAddon({ svg: await fs.readTextFile(absPath(it.file)), name: it.name, style });
      if (r.mesh) icons.push({ id: it.id, name: it.name, file: it.file, mesh: r.mesh });
      else skipped.push(it.name);
    } catch (e) { skipped.push(it.name); }
  }
  if (!icons.length) { toast('Ни одна иконка не превратилась в 3D: в SVG нет залитых фигур (только обводки?)'); return; }
  const set = setName || 'Набор';
  await textToBlender(JSON.stringify({ set, style, icons }), set + '.perchicons', `Иконки (${icons.length})`);
  if (skipped.length) toast(`Без залитых фигур, пропущены: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`, 6000);
}
