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

// a file made on the fly (the SVG → 3D result) that is not in the library: written to the app's outbox folder first
export async function textToBlender(text, fileName, what) {
  if (!(typeof window !== 'undefined' && window.__TAURI_INTERNALS__)) return toBlender([], what);
  try {
    const dir = await join(await appLocalDataDir(), 'outbox');
    await fs.mkdir(dir, { recursive: true });
    const path = await join(dir, fileName.replace(/[\\/:*?"<>|]/g, '_'));
    await fs.writeTextFile(path, text);
    await toBlender([path], what);
  } catch (e) { toast('Не удалось отправить в Blender: ' + (e && e.message ? e.message : e)); }
}
