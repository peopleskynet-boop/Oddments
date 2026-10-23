// Files added before the new palette (palette.js, #79) get it in the background, from their own thumbnails: a few at a
// time, while the window is idle, saving the index every 20. Models and materials keep theirs (made from a transparent
// render without the backdrop); fonts and audio have none.
import * as fs from '@tauri-apps/plugin-fs';
import { S, ui } from '../state.js';
import { absPath, saveIndex } from './library.js';
import { extractPalette, PALETTE_V } from './palette.js';

const KINDS = new Set(['image', 'gif', 'video', 'pdf', 'psd', 'link', 'figma']);
let running = false;

export async function refreshPalettes() {
  if (running) return;
  running = true;
  try {
    const todo = S.items.filter((it) => !it.trashed && it.thumb && KINDS.has(it.kind) && it.palV !== PALETTE_V);
    let n = 0, touchedSel = false;
    for (const it of todo) {
      if (document.hidden) await new Promise((r) => document.addEventListener('visibilitychange', r, { once: true }));
      await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 400 }) : setTimeout(r, 30)));
      try {
        const bytes = await fs.readFile(absPath(it.thumb));
        const bmp = await createImageBitmap(new Blob([bytes]));
        const p = extractPalette(bmp);
        bmp.close && bmp.close();
        if (p.colors.length) { it.colors = p.colors; it.shares = p.shares; }
        it.palV = PALETTE_V;
        if (S.sel.has(it.id)) touchedSel = true;
      } catch (e) { it.palV = PALETTE_V; /* an unreadable thumbnail: keep the old palette, do not retry forever */ }
      if (++n % 20 === 0) saveIndex();
    }
    if (n) { saveIndex(); if (touchedSel) ui.refresh(); }
  } finally { running = false; }
}
