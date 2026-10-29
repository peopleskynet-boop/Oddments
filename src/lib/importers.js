// «Перенести из Eagle» and «Доски PureRef» (Добавить › …, the palette, the first-run window). Copies, never moves:
// the other app's library stays as it was.
// Eagle: the library's folders become collections under one «Eagle · <name>» collection; each file keeps its name,
// tags, note (with Eagle's comments), link and date. A second import of the same library adds only what is new —
// items and collections carry Eagle's id in the optional `eagle` field (index.json needs no migration).
// PureRef: the pictures of each .pur become one collection «PureRef · <board>»; the board's layout is not read
// (importfmt.js says why).
import * as fs from '@tauri-apps/plugin-fs';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { S, ui } from '../state.js';
import { uid, baseName, plural } from '../util.js';
import { SEP, addFromPaths, addFromBlobs, saveIndex } from './library.js';
import { busy, busyDone, toast } from '../ui/dialogs.js';
import { eagleFolders, eagleItem, eagleOriginal, scanImages } from './importfmt.js';

const why = (e) => String((e && e.message) || e || '').slice(0, 160);

// a collection found again by its importer key, or made
function folderFor(key, name, parent) {
  let f = S.folders.find((x) => x.eagle === key);
  if (!f) { f = { id: uid(), name, parent, open: false, eagle: key }; S.folders.push(f); }
  return f.id;
}

export async function importEagle() {
  let dir;
  try { dir = await openDialog({ directory: true, recursive: true, multiple: false, title: 'Библиотека Eagle — папка, которая кончается на .library' }); }
  catch (e) { toast('Не удалось открыть окно выбора папки: ' + why(e)); return; }
  if (!dir) return;
  if (Array.isArray(dir)) dir = dir[0];
  // the .library itself, or the folder that holds one
  let lib = dir;
  if (!(await fs.exists(lib + SEP + 'metadata.json').catch(() => false))) {
    const inner = (await fs.readDir(dir).catch(() => [])).find((e) => e.isDirectory && /\.library$/i.test(e.name));
    if (inner) lib = dir + SEP + inner.name;
  }
  let meta;
  try { meta = JSON.parse(await fs.readTextFile(lib + SEP + 'metadata.json')); if (!Array.isArray(meta.folders)) throw new Error('нет списка папок'); }
  catch (e) { toast('Не удалось открыть библиотеку Eagle: это не папка .library (в ней нет metadata.json). Выберите папку библиотеки — в Eagle её показывает «Библиотека › Показать в проводнике».', 10000); return; }
  const name = baseName(lib).replace(/\.library$/i, '') || 'Eagle';
  let entries;
  try { entries = (await fs.readDir(lib + SEP + 'images')).filter((e) => e.isDirectory && /\.info$/i.test(e.name)); }
  catch (e) { toast('Не удалось прочитать файлы Eagle: ' + why(e) + '. Закройте Eagle и попробуйте ещё раз.'); return; }

  busy(`Читаю библиотеку Eagle «${name}»…`);
  const top = folderFor('library:' + name, `Eagle · ${name}`, null);
  const ids = new Map();
  for (const f of eagleFolders(meta)) ids.set(f.id, folderFor(f.id, f.name, f.parent ? ids.get(f.parent) || top : top));
  const have = new Set(S.items.map((i) => i.eagle).filter(Boolean));
  const plan = new Map();
  let already = 0, unread = 0, n = 0;
  for (const d of entries) {
    if (++n % 40 === 0) busy(`Читаю библиотеку Eagle: ${n} из ${entries.length}`, n / entries.length);
    const p = lib + SEP + 'images' + SEP + d.name;
    try {
      const m = JSON.parse(await fs.readTextFile(p + SEP + 'metadata.json'));
      const patch = eagleItem(m, ids);
      if (!patch) continue; // in Eagle's trash
      if (have.has(patch.eagle)) { already++; continue; }
      const orig = eagleOriginal((await fs.readDir(p)).map((e) => e.name), m);
      if (!orig) { unread++; continue; }
      if (!patch.folders.length) patch.folders = [top];
      plan.set(p + SEP + orig, { ...patch, fresh: false }); // a moved library is not a wall of «new»
    } catch (e) { unread++; }
  }
  busyDone();
  saveIndex(); // the collections, even when every file was already in
  ui.refresh();
  if (!plan.size) { toast(already ? `Всё из «${name}» уже в Oddments` : `В библиотеке «${name}» не нашлось файлов`, 6000); return; }
  const added = await addFromPaths([...plan.keys()], { meta: (path) => plan.get(path) });
  const tail = [already && `уже были: ${already}`, unread && `не прочитано: ${unread}`].filter(Boolean).join(' · ');
  toast(`Из Eagle перенесено: ${added.length} ${plural(added.length, ['файл', 'файла', 'файлов'])}${tail ? ' · ' + tail : ''}. Библиотека Eagle не тронута.`, 9000);
}

export async function importPureRef() {
  let r;
  try { r = await openDialog({ multiple: true, title: 'Доски PureRef', filters: [{ name: 'PureRef', extensions: ['pur'] }] }); }
  catch (e) { toast('Не удалось открыть окно выбора файлов: ' + why(e)); return; }
  const paths = Array.isArray(r) ? r : r ? [r] : [];
  let total = 0;
  for (const p of paths) {
    const board = baseName(p).replace(/\.pur$/i, '');
    busy(`Читаю доску «${board}»…`);
    let bytes;
    try { bytes = await fs.readFile(p); } catch (e) { busyDone(); toast(`Не удалось прочитать «${board}»: ${why(e)}`); continue; }
    // the same picture placed twice on a board is stored once; a copy that is still repeated is skipped by its hash
    const seen = new Set(), list = [];
    for (const f of scanImages(bytes)) {
      const part = bytes.subarray(f.start, f.end);
      const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', part)), (x) => x.toString(16).padStart(2, '0')).join('');
      if (seen.has(h)) continue;
      seen.add(h);
      list.push({ blob: new Blob([part], { type: f.type === 'jpg' ? 'image/jpeg' : 'image/' + f.type }), name: `${board} ${String(list.length + 1).padStart(2, '0')}.${f.type}`, source: '' });
    }
    busyDone();
    if (!list.length) { toast(`В «${board}» не нашлось картинок — возможно, доска сохранена версией PureRef, которую Oddments пока не читает.`, 8000); continue; }
    const folder = { id: uid(), name: `PureRef · ${board}`, parent: null, open: false };
    S.folders.push(folder);
    const added = await addFromBlobs(list, { folder: folder.id });
    total += added.length;
  }
  if (total) toast(`Из PureRef: ${total} ${plural(total, ['картинка', 'картинки', 'картинок'])}. Расположение на доске не переносится — только сами картинки.`, 8000);
}
