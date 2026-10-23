// Dragging files OUT of Oddments into other programs — PureRef, Blender, Figma, Photoshop, Explorer (the night's list,
// item 10): the system's own file drag (tauri-plugin-drag, CrabNebula, MIT/Apache) with the originals' paths. Started
// from the properties panel's picture, the open preview and the selection bar's grip — not from grid cards, whose
// drag stays the in-app one (onto collections, the trash). In the browser build there is no system drag: a hint.
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import * as fs from '@tauri-apps/plugin-fs';
import { absPath, assetUrl } from './library.js';

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// the picture under the cursor while dragging: a small PNG of the first file's thumbnail, written to app data
async function iconFor(it) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const x = c.getContext('2d');
  try {
    if (it && it.thumb) {
      const im = new Image();
      im.src = assetUrl(it.thumb);
      await im.decode();
      const s = Math.min(96 / im.naturalWidth, 96 / im.naturalHeight);
      x.drawImage(im, (96 - im.naturalWidth * s) / 2, (96 - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
    } else throw new Error('no thumb');
  } catch (e) {
    x.fillStyle = '#2a2a2e'; x.beginPath(); x.roundRect(8, 8, 80, 80, 16); x.fill();
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const p = await join(await appLocalDataDir(), 'drag-icon.png');
  await fs.writeFile(p, new Uint8Array(await blob.arrayBuffer()));
  return p;
}

export async function dragOut(items, icon) {
  const list = items.filter((it) => it && it.file && !it.trashed);
  if (!list.length) return false;
  if (!inApp()) return false;
  const { startDrag } = await import('@crabnebula/tauri-plugin-drag');
  await startDrag({ item: list.map((it) => absPath(it.file)), icon: icon || await iconFor(list[0]), mode: 'copy' });
  return true;
}

// The system drag starts from the browser's own `dragstart` (as the plugin's example does): on Windows the OS drag loop
// needs that gesture — started from a plain pointermove after an await it never took off (bug #88). The icon is made on
// pointerdown, so dragstart only hands it over. A click without a drag shows `hint` (the grip is not a button).
const icons = new Map(); // first item id → Promise<icon path>
export function bindDragOut(root, selector, getItems, onWeb, hint) {
  root.addEventListener('pointerdown', (e) => {
    const el = e.button === 0 && e.target.closest && e.target.closest(selector);
    if (!el) return;
    el.draggable = true;
    const it = (getItems() || [])[0];
    if (inApp() && it && !icons.has(it.id)) icons.set(it.id, iconFor(it).catch(() => ''));
  });
  root.addEventListener('dragstart', (e) => {
    if (!e.target.closest || !e.target.closest(selector)) return;
    e.preventDefault(); // no browser «ghost»: the OS drag takes over
    if (!inApp()) { if (onWeb) onWeb(); return; }
    const items = getItems() || [];
    const first = items[0];
    Promise.resolve(first && icons.get(first.id)).then((icon) => dragOut(items, icon || undefined))
      .catch((err) => import('../ui/dialogs.js').then((d) => d.toast('Не получилось перетащить: ' + (err && err.message ? err.message : err))));
  });
  if (hint) root.addEventListener('click', (e) => { if (e.target.closest && e.target.closest(selector)) hint(); });
}
