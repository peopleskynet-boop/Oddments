// Oddments Web («Oddments в браузере», `npm run lite` / `npm run build:lite`): the same code as the app, built for a
// browser tab — only collecting references and what serves it. vite.config.js (mode «lite») swaps the Tauri modules for
// src/web/lite-*.js (files over a FileSystemDirectoryHandle: OPFS or a folder on disk) and replaces whole sections by
// stubs (LITE_OFF there), so their code and what they pull in (onnxruntime, paper, Spark…) are not in the build. The
// interface hides what is not there with LITE and the action ids below. In the app and `npm run web` LITE is false.
export const LITE = typeof __ODD_LITE__ !== 'undefined' && __ODD_LITE__ === true;

// actions of the card menu, the palette and the properties panel that are not in Oddments Web
export const LITE_OFF_ACTS = new Set([
  'app', 'reveal', 'cutout', 'upscale', 'effects', 's3d', 'ik', 'splatmk', 'flow', 'svgfix', 's3dset', 'blender',
  'mask', 'brand', 'teamtake', 'toteam', 'show', 'export', 'ocrcopy', 'sp-svg', 'sp-mat', 'hdrsend', 'toblender',
  'brandset', 'piino', 'aion', 'share', 'relink', 'cover',
]);
// A shared link («Поделиться ссылкой», lib/share.js): the link's own page (<meta name="odd-share">; its library lies next to
// it under lib/), or ?share=<a link's address> while testing. The address of that library, '' otherwise. Only looking:
// nothing is added, changed or kept.
export const SHARE = LITE && typeof document !== 'undefined' ? (() => {
  const m = document.querySelector('meta[name="odd-share"]');
  if (m && /^[0-9a-zA-Z]+$/.test(m.content)) return new URL(`/s/${m.content}/`, location.href).href;
  const q = new URLSearchParams(location.search).get('share');
  return q && /^https?:\/\//.test(q) ? q.replace(/\/?$/, '/') : '';
})() : '';
// what a link's visitor cannot do: it changes the library
const SHARE_OFF_ACTS = new Set(['fav', 'folder', 'notes', 'rename', 'trash', 'restore', 'pv-frame', 'sp-add', 'sp-paste', 'sp-dir', 'sp-folder', 'sp-set', 'flow']);
export const liteOff = (id) => LITE && (LITE_OFF_ACTS.has(id) || (!!SHARE && SHARE_OFF_ACTS.has(id)));
