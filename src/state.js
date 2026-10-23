// Shared application state. UI modules register their render functions in `ui`
// so that logic modules can ask for a refresh without importing UI code.
export const S = {
  items: [],
  folders: [],
  byId: new Map(),
  view: { type: 'all', id: null },
  q: '',
  sort: 'added',
  dir: -1,
  color: null,
  colorTol: 60,   // 0..100, how loosely the colour search matches
  sel: new Set(),
  last: null,
  vis: [],
  previewId: null,
};

export const ui = {
  refresh() {},      // re-filter and redraw grid + counts + inspector
  renderSide() {},
  renderInsp() {},
  relayout() {},
  toast() {},
  freshChanged() {}, // a new file was seen: update counters only
};

export const SMART_RECENT_DAYS = 7;
// «Недавние» = the latest additions, not «everything of the last 7 days» (bug #64: a library built within a week was
// all «recent», the view repeated «Все файлы»). Additions come in sessions (a paste, an import, an evening of saving):
// the last 3 sessions (a gap of 30+ minutes starts a new one), at most 100 files, none older than the 7 days.
const RECENT_MAX = 100, RECENT_SESSIONS = 3, SESSION_GAP = 30 * 60000;
let recentKey = '', recentIds = new Set();
export function recentSet() {
  const live = S.items.filter((i) => !i.trashed);
  const key = live.length + ':' + live.reduce((m, i) => Math.max(m, i.added || 0), 0);
  if (key === recentKey) return recentIds;
  const lim = Date.now() - SMART_RECENT_DAYS * 864e5;
  const by = live.filter((i) => i.added > lim).sort((a, b) => b.added - a.added);
  const out = [];
  let sessions = 1;
  for (let k = 0; k < by.length && out.length < RECENT_MAX; k++) {
    if (k && by[k - 1].added - by[k].added > SESSION_GAP && ++sessions > RECENT_SESSIONS) break;
    out.push(by[k].id);
  }
  recentKey = key; recentIds = new Set(out);
  return recentIds;
}

export const KINDS = {
  image: { label: 'Изображения', ext: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'svg', 'ico'] },
  gif: { label: 'GIF', ext: ['gif'] },
  video: { label: 'Видео', ext: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'ogv'] },
  audio: { label: 'Аудио', ext: ['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'opus'] },
  font: { label: 'Шрифты', ext: ['ttf', 'otf', 'woff', 'woff2'] },
  pdf: { label: 'PDF', ext: ['pdf'] },
  psd: { label: 'PSD', ext: ['psd', 'psb'] },
  model: { label: '3D', ext: ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'dae', '3mf', '3ds', 'usdz', 'blend', 'abc'] }, // .blend/.abc: no viewer
  material: { label: 'Материалы', ext: ['perchmat'] }, // PBR set packed by Oddments: material.json + maps (lib/material.js)
  block: { label: 'Блоки', ext: ['oddblock'] }, // a block of a page's layout from the browser extension: shot + live markup (lib/block.js)
  figma: { label: 'Figma', ext: ['fig'] },
  link: { label: 'Ссылки', ext: ['url'] },
  other: { label: 'Другое', ext: [] },
};

export function kindOf(ext) {
  for (const k of Object.keys(KINDS)) if (KINDS[k].ext.includes(ext)) return k;
  return 'other';
}

export const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  svg: 'image/svg+xml', ico: 'image/x-icon', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  pdf: 'application/pdf', psd: 'image/vnd.adobe.photoshop', psb: 'image/vnd.adobe.photoshop',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj', fbx: 'model/x-fbx', stl: 'model/stl', blend: 'application/x-blender', ply: 'model/x-ply', dae: 'model/vnd.collada+xml', '3mf': 'model/3mf', '3ds': 'application/x-3ds', usdz: 'model/vnd.usdz+zip', abc: 'application/x-alembic', fig: 'application/x-figma', url: 'application/x-url', perchmat: 'application/x-perch-material', oddblock: 'application/x-oddments-block',
};

export function extFromMime(mime) {
  const m = (mime || '').toLowerCase();
  for (const [e, v] of Object.entries(MIME)) if (v === m) return e === 'jpeg' ? 'jpg' : e;
  return '';
}

// Folder helpers
export const folderById = (id) => S.folders.find((f) => f.id === id);
export function descend(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of S.folders) if (f.parent && out.has(f.parent) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}
export function flatFolders() {
  const out = [];
  (function walk(parent, depth) {
    S.folders.filter((f) => (f.parent || null) === parent).forEach((f) => { out.push({ f, d: depth }); walk(f.id, depth + 1); });
  })(null, 0);
  return out;
}
export const activeItems = () => S.items.filter((i) => !i.trashed);
