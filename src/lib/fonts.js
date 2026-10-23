// Loads a stored font file into the page on demand so it can be shown in the inspector and viewer.
import * as fs from '@tauri-apps/plugin-fs';
import { absPath } from './library.js';

const cache = new Map();
export const fontFamily = (it) => 'pf-' + it.id;

export function ensureFont(it) {
  if (!cache.has(it.id)) {
    cache.set(it.id, (async () => {
      const bytes = await fs.readFile(absPath(it.file));
      const face = new FontFace(fontFamily(it), bytes);
      await face.load();
      document.fonts.add(face);
      return true;
    })().catch(() => false));
  }
  return cache.get(it.id);
}
