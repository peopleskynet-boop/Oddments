// AutoRemesher (frontend side): the bundled autoremesher.exe runs without a window through the Rust command
// in src-tauri/src/remesher.rs; here the model goes in as OBJ text, progress comes back as events, and the
// remeshed OBJ text is returned. Desktop only — the web build has no Rust side.
import { invoke } from '@tauri-apps/api/core';
import * as fs from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

let found; // undefined: not looked for yet
async function exe() {
  if (found === undefined) { try { found = inApp() ? await invoke('find_remesher') : null; } catch (e) { found = null; } }
  return found || null;
}
export const remesherReady = async () => !!(await exe());

// params: { targetQuads, sharpEdge, adaptivity, anisotropy, edgeScaling }
export async function remesh(objText, params, onProgress) {
  if (!inApp()) throw new Error('AutoRemesher работает в приложении для компьютера, в веб-версии его нет.');
  const e = await exe();
  if (!e) throw new Error('AutoRemesher не найден в этой сборке Oddments.');
  const dir = await join(await appLocalDataDir(), 'remesh');
  await fs.mkdir(dir, { recursive: true });
  const stamp = Date.now();
  const input = await join(dir, `in-${stamp}.obj`), output = await join(dir, `out-${stamp}.obj`);
  await fs.writeTextFile(input, objText);
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen('perch-remesh-progress', (ev) => { const [pct, stage] = ev.payload || []; if (onProgress) onProgress(pct, stage); });
  try {
    const stats = await invoke('autoremesh', { exe: e, input, output, params });
    return { text: await fs.readTextFile(output), stats };
  } finally {
    unlisten();
    fs.remove(input).catch(() => {});
    fs.remove(output).catch(() => {});
  }
}

// AutoRemesher's stages, in the user's words
export const STAGES = {
  'Computing voxel size': 'Готовлю модель',
  'Splitting mesh into islands': 'Делю на части',
  'Building island contexts': 'Готовлю части',
  'Remeshing uniformly': 'Выравниваю сетку',
  'Building bounding volume tree': 'Выравниваю сетку',
};
