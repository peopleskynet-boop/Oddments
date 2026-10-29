// The app's entry point: starts the library, the panels and the grid, wires the events — paste (Ctrl+V), drag and drop,
// the wall's keys (one table with the «?» sheet, ui/hotkeys.js), the window and tray — and owns ui.refresh(), the one
// redraw of the sidebar, header, grid and inspector after anything changes. Screens load lazily (ui/lazy.js).
import '@fontsource-variable/golos-text';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/onest';
import './styles.css';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { S, ui, isPic } from './state.js';
import { $, $$, esc, plural, debounce, hexRGB, isMac } from './util.js';
import { ic } from './ui/icons.js';
import { toast, isAskOpen, arm, trapTab } from './ui/dialogs.js';
import { settings, loadSettings, applySettings, toggleSettings, isSettingsOpen, setLayoutPrefs, openSettings } from './ui/settings.js';
import { initGrid, layoutGrid, refreshSelection, scrollToItem, syncCard, setCursor, cursorIndex, firstInView, neighbour } from './ui/grid.js';
import { renderSide, initSidebar, newFolder } from './ui/sidebar.js';
import { renderHead, initHead } from './ui/hero.js';
import { initBridge, pushSelection, pushCatalog } from './lib/bridge.js';
import { initAi, aiKick } from './lib/ai.js';
import { initAiBar, updateAiChip } from './ui/aibar.js';
import { initShelf, renderShelf } from './ui/matshelf.js';
import { enhanceSelect } from './ui/gselect.js';
import { initMotion, motionOn } from './ui/motion.js';
import { initSprings } from './ui/spring.js';
import { initGlide } from './ui/glide.js';
import { initElastic } from './ui/elastic.js';
import { initPalette } from './ui/palette.js';
import { toggleColor, close as closeColor, isColorOpen } from './ui/colorpick.js';
import { renderInsp, initInspector } from './ui/inspector.js';
import { openPreview, closePreview, stepPreview, isPreviewOpen, zoomKey, setPreviewKeys } from './ui/preview.js';
import { onLayers, layerOpen } from './ui/layers.js';
import { hotkey, runHotkey, plain, mod } from './ui/hotkeys.js';
import { computeVisible, setView } from './lib/filter.js';
import { initLibrary, getRoot, addFromPaths, addFromBlobs, trashItems, restoreItems, purgeItems, flushIndex, saveIndex } from './lib/library.js';
import { extractFromTransfer, readNativeClipboardImage } from './lib/clipboard.js';
import { figmaClipboard, parseFigmaUrl, urlShortcut, parseVideoUrl, videoTitle } from './lib/figma.js';
import { showQuickFile, closeQuick, isQuickOpen } from './ui/quickfile.js';
import { initMarquee } from './ui/marquee.js';
import { initContextMenu } from './ui/ctxmenu.js';
import { initSelBar, updateSelBar } from './ui/selbar.js';
import { setLazySelection, preloadLazy, isOverlayOpen, closeOverlays, isDupesOpen, closeDupes, closeTidy, openRename } from './ui/lazy.js';
import { initSound, sfx } from './ui/sound.js';
import { initOnboard, markStep } from './ui/onboard.js';
import { initFrame } from './ui/frame.js';
import { initPixel } from './ui/pixel.js';
import { bootIntro, bootDone } from './ui/boot.js';
import { initI18n, lang, t } from './lib/i18n.js';
import { initClean, cleanOn, toggleCleanSide, setClean, updateHud } from './ui/clean.js';
import { lockWindow } from './lib/net.js';
import { initCrashLog } from './lib/crashlog.js';

const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const selItems = () => Array.from(S.sel).map((id) => S.byId.get(id)).filter(Boolean);
const NAV = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function ctxFromView() {
  const v = S.view;
  return v.type === 'folder' ? { folder: v.id } : v.type === 'tag' ? { tag: v.id } : null;
}

/* ---------- rendering glue ---------- */
const renderHeader = renderHead;

ui.refresh = () => {
  computeVisible();
  S.sel.forEach((id) => { if (!S.byId.get(id)) S.sel.delete(id); });
  layoutGrid(true);
  renderHeader();
  renderSide();
  renderInsp();
  ambient();
  pushSelection();
  pushCatalog();
  renderShelf();
  aiKick();
  ocrKick();
  updateHud();
  updateSelBar();
  updateAiChip();
};
ui.relayout = () => { layoutGrid(false); };
// text on pictures (ocr.js) loads a few seconds after the start, so the first screen does not wait for it
let ocrMod = null;
const ocrKick = () => { if (ocrMod) ocrMod.ocrKick(); };
ui.freshChanged = () => { renderHeader(); renderSide(); };
ui.renderSide = renderSide;
ui.renderInsp = renderInsp;
ui.syncCard = syncCard; // one card's marks (favourite, personal data) without a redraw
ui.toast = toast;
ui.addBlobs = (list) => addBlobs(list, {}); // the feed saves pictures through the usual path (and its «куда положить»)

// Ambient light behind the grid takes its colours from the selected file (Savee-style).
function ambient() {
  const it = S.sel.size ? S.byId.get(Array.from(S.sel)[S.sel.size - 1]) : null;
  // the most vivid colours light the room best; near-black and near-white do nothing
  const vivid = (h) => { const [r, g, b] = hexRGB(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return (mx - mn) + mx * 0.25; };
  const c = ((it && it.colors) || []).slice().sort((a, b) => vivid(b) - vivid(a));
  const m = $('#main');
  if (c.length) { m.style.setProperty('--amb1', c[0]); m.style.setProperty('--amb2', c[1] || c[0]); m.classList.add('lit'); }
  else m.classList.remove('lit');
}

// Smooth reflow: while the layout changes (a panel slides in or out, masonry ↔ grid), cards glide to
// their new places instead of jumping, and the view header slides along (FLIP: measure, change, invert, play).
let reflowT = null;
function reflow(update) {
  const els = Array.from(document.querySelectorAll('.head, .covers, .tabrow, .newbar, #grid'));
  const before = els.map((e) => e.getBoundingClientRect().left);
  document.body.classList.add('reflow');
  clearTimeout(reflowT);
  reflowT = setTimeout(() => document.body.classList.remove('reflow'), 700);
  update();
  if (!motionOn()) return;
  els.forEach((e, i) => {
    const d = before[i] - e.getBoundingClientRect().left;
    if (!d) return;
    e.style.transition = 'none';
    e.style.transform = `translateX(${d}px)`;
    void e.offsetWidth; // apply the start position before animating
    e.style.transition = 'transform .45s cubic-bezier(.2, .7, .2, 1)';
    e.style.transform = '';
    setTimeout(() => { e.style.transition = ''; }, 500);
  });
}

function selectionChanged() {
  pushSelection();
  ambient();
  refreshSelection();
  renderHeader();
  renderInsp();
  updateSelBar();
  makeRoom();
}

// The properties panel floats over the grid (settings.overlay): a selected card under it would be hidden. Then the
// grid makes room for the panel (the cards glide aside) and keeps it while anything is selected, so it does not jump
// between clicks; with nothing selected the grid takes the whole width again.
// a narrow window: the panel is a sheet at the bottom — the selected card is scrolled to sit above it
function aboveSheet() {
  const insp = $('#insp'), id = S.last && S.sel.has(S.last) ? S.last : [...S.sel][0];
  const c = id && document.getElementById('c-' + id), sc = document.querySelector('.scroll');
  if (!insp || !c || !sc) return;
  const r = insp.getBoundingClientRect(), q = c.getBoundingClientRect();
  if (!r.height || q.bottom <= r.top - 12) return;
  sc.scrollBy({ top: Math.min(q.top - 90, q.bottom - (r.top - 12)), behavior: document.body.classList.contains('motion') ? 'smooth' : 'auto' });
}
function makeRoom() {
  const b = document.body, on = b.classList.contains('insp-room');
  if (innerWidth <= 860 && S.sel.size && !b.classList.contains('insp-off')) setTimeout(aboveSheet, 280);
  if (!settings.overlay || b.classList.contains('insp-off') || innerWidth <= 860) { if (on) reflow(() => { b.classList.remove('insp-room'); ui.refresh(); }); return; }
  if (!S.sel.size) { if (on) reflow(() => { b.classList.remove('insp-room'); ui.refresh(); }); return; }
  if (on) return;
  setTimeout(() => { // after the panel has come out (it is not laid out at the moment of the click)
    if (!S.sel.size || b.classList.contains('insp-room')) return;
    const insp = $('#insp'), r = insp && insp.getBoundingClientRect();
    if (!r || !r.width) return;
    // a narrow window (≤ 1000 px): the panel would cover half the grid — it always makes room there (audit 24.10)
    const hidden = innerWidth <= 1000 || [...S.sel].some((id) => { const c = document.getElementById('c-' + id); if (!c) return false; const q = c.getBoundingClientRect(); return q.right > r.left + 24 && q.left < r.right && q.bottom > r.top && q.top < r.bottom; });
    if (hidden) reflow(() => { b.classList.add('insp-room'); ui.refresh(); });
  }, 120);
}

// Keyboard navigation over the virtual grid: works from S.vis and layout boxes, not DOM focus,
// because cards outside the viewport do not exist in the DOM.
function navGrid(key, extend) {
  const i = cursorIndex();
  const j = key === 'Home' ? 0 : key === 'End' ? S.vis.length - 1 : i < 0 ? firstInView() : neighbour(i, NAV[key]);
  if (j < 0) return;
  const id = S.vis[j].id;
  if (extend) {
    const ids = S.vis.map((x) => x.id);
    let a = S.last ? ids.indexOf(S.last) : -1;
    if (a < 0) a = i >= 0 ? i : j;
    S.last = ids[a];
    S.sel = new Set(ids.slice(Math.min(a, j), Math.max(a, j) + 1));
  } else { S.sel = new Set([id]); S.last = id; }
  setCursor(id);
  document.body.classList.add('kbd');
  scrollToItem(id);
  selectionChanged();
}
// The card Space/Enter opens: the keyboard cursor if it is selected, else the first selected card.
function focusedId() {
  const i = cursorIndex(), id = i >= 0 ? S.vis[i].id : null;
  return id && S.sel.has(id) ? id : Array.from(S.sel)[0];
}

function fatal(msg) {
  $('#empty').hidden = false;
  $('#empty').innerHTML = `<div><h2>Не удалось открыть библиотеку</h2>${esc(msg)}</div>`;
}

/* ---------- adding ---------- */
// every way of adding ends with the "where should it go?" pill
const added = (list) => { if (list && list.length) markStep('add'); return showQuickFile(list); };
// zips with texture sets (Poly Haven, ambientCG…) come in as materials (.perchmat), see ui/materials.js
const addPaths = async (paths, ctx) => {
  const m = paths.some((p) => /\.zip$/i.test(p)) ? await (await import('./ui/materials.js')).splitPaths(paths) : { paths, blobs: [] };
  const a = m.blobs.length ? await addFromBlobs(m.blobs, ctx) : [];
  const b = m.paths.length ? await addFromPaths(m.paths, ctx) : [];
  return added([...a, ...b]);
};
// files that came as paths in a drag or paste (Telegram) lie outside the library's disk scope: Rust opens
// exactly those files for reading first (allow_dropped)
const addDropped = async (paths, ctx) => {
  let ok = paths;
  try { const { invoke } = await import('@tauri-apps/api/core'); ok = await invoke('allow_dropped', { paths }); } catch (e) { /* browser build */ }
  if (ok.length) return addPaths(ok, ctx);
  toast('Не удалось открыть перетащенный файл: его уже нет на диске или к нему нет доступа.');
};
// a video link (YouTube, Vimeo, a Pinterest pin) becomes a link card with the clip's title and cover;
// a Pinterest pin comes in as what it holds — the video file (plays in Oddments, offline) or the original picture
const addVideoLink = async (v, ctx) => {
  if (v.site === 'Pinterest') {
    toast('Pinterest: забираю пин…');
    try {
      const vl = await import('./lib/videolink.js');
      const m = await vl.pinterestMedia(v.url);
      if (m) {
        const { blob, ext } = await vl.downloadMedia(m);
        const name = (m.title || `Pinterest ${v.id}`).replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.' + ext;
        return addBlobs([{ blob, name, source: v.url }], ctx);
      }
    } catch (e) { console.warn('pinterest', e); }
  }
  const title = (await videoTitle(v)) || `${v.site} ${v.id}`;
  return addBlobs([{ blob: urlShortcut(v.url), name: title.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.url', source: v.url }], ctx);
};
const addBlobs = async (list, ctx) => {
  if (list.some((e) => /\.zip$/i.test(e.name || ''))) list = await (await import('./ui/materials.js')).splitBlobs(list);
  return addFromBlobs(list, ctx).then(added);
};

async function pickFiles() {
  try {
    const r = await openDialog({ multiple: true, title: 'Добавить файлы' });
    const paths = Array.isArray(r) ? r : r ? [r] : [];
    if (paths.length) await addPaths(paths, ctxFromView());
  } catch (e) { toast('Не удалось открыть окно выбора файлов. Перетащите файлы прямо в окно Oddments.'); }
}
async function pickFolder() {
  try {
    const r = await openDialog({ directory: true, recursive: true, multiple: false, title: 'Импорт папки' });
    if (r) await addPaths([r], ctxFromView());
  } catch (e) { toast('Не удалось открыть окно выбора папки. Перетащите папку прямо в окно Oddments.'); }
}
async function pasteNow() {
  let list = await readNativeClipboardImage();
  if (!list.length) {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) list.push({ blob: await it.getType(type), name: 'image.' + type.split('/')[1], source: '' });
      }
    } catch (e) { /* ignore */ }
  }
  if (list.length) addBlobs(list, ctxFromView()); else toast('В буфере обмена нет картинки. Скопируйте её (в Figma — Ctrl Shift C) и нажмите Ctrl V ещё раз.');
}

/* ---------- events ---------- */
function bind() {
  $('#icSearch').innerHTML = ic('search');
  $('#navBtn').innerHTML = ic('menu'); $('#navClose').innerHTML = ic('x');
  $('#filtBtn').innerHTML = '<span class="rainbow"></span>';
  $('#simBtn').innerHTML = ic('scan'); $('#backBtn').innerHTML = ic('left');
  $('#addBtn').innerHTML = ic('plus') + '<span>Добавить</span>';
  $('#addDirBtn').innerHTML = ic('folderplus') + '<span>Импортировать папку</span>';
  $('#eagleBtn').innerHTML = ic('download') + '<span>Перенести из Eagle…</span>';
  $('#purBtn').innerHTML = ic('image') + '<span>Картинки с доски PureRef…</span>';
  $('#flowBtn').innerHTML = ic('flow') + '<span>Сценарий из записи экрана…</span>';
  $('#matBtn').innerHTML = ic('sphere') + '<span>Материал из текстур…</span>';
  $('#pasteBtn').innerHTML = ic('paste') + '<span>Вставить из буфера</span><kbd>Ctrl V</kbd>';
  $('#addMore').innerHTML = ic('chev');
  $('#addMore').addEventListener('click', (e) => { e.stopPropagation(); $('#addMenu').classList.toggle('open'); });
  $('#addMenu').addEventListener('click', () => $('#addMenu').classList.remove('open'));
  document.addEventListener('click', (e) => { if (!e.target.closest('#addMenu')) $('#addMenu').classList.remove('open'); });
  $('#lyM').innerHTML = ic('masonry'); $('#lyG').innerHTML = ic('grid');
  $('#sideTog').innerHTML = ic('sideL'); $('#inspTog').innerHTML = ic('info');
  $('#pvX').innerHTML = ic('x'); $('#setBtn').innerHTML = ic('gear');
  // interface sounds off and on in one click; the volume they had comes back (Настройки › Эффекты sets it)
  const sndIcon = () => {
    const on = settings.sound > 0;
    $('#sndBtn').innerHTML = ic(on ? 'soundOn' : 'soundOff');
    $('#sndBtn').setAttribute('aria-pressed', String(on));
    $('#sndBtn').setAttribute('aria-label', on ? 'Выключить звуки интерфейса' : 'Включить звуки интерфейса');
    $('#sndBtn').title = on ? 'Звуки интерфейса: выключить' : 'Звуки интерфейса: включить';
  };
  sndIcon();
  $('#sndBtn').addEventListener('click', () => {
    let last = 40;
    try { last = +localStorage.getItem('perch.soundLast') || 40; } catch (e) { /* private mode */ }
    if (settings.sound > 0) { try { localStorage.setItem('perch.soundLast', String(settings.sound)); } catch (e) { /* */ } setLayoutPrefs({ sound: 0 }); }
    else { setLayoutPrefs({ sound: last }); sfx('on'); }
    sndIcon();
    if (isSettingsOpen()) openSettings(); // the slider there follows
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'sSound') sndIcon(); });
  // our own window frame in the app (tauri.conf: decorations off): minimise / maximise / close at the end of the
  // top bar, a thin strip along the top edge drags the window (double click maximises); close obeys «трей»
  if (window.__TAURI_INTERNALS__) {
    document.body.classList.add('tauri');
    $('#wctl').hidden = false; $('.dragtop').hidden = false;
    // the whole top bar moves the window: every empty spot between its capsules (the capsules themselves stay buttons)
    $('#bar').setAttribute('data-tauri-drag-region', '');
    $('#wMin').innerHTML = ic('minus'); $('#wClose').innerHTML = ic('x');
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      const maxIcon = async () => {
        const on = await w.isMaximized();
        $('#wMax').innerHTML = ic(on ? 'restoreWin' : 'square');
        $('#wMax').setAttribute('aria-label', on ? 'Восстановить' : 'Развернуть'); $('#wMax').title = on ? 'Восстановить' : 'Развернуть';
      };
      maxIcon();
      w.onResized(maxIcon);
      $('#wMin').addEventListener('click', () => w.minimize());
      $('#wMax').addEventListener('click', () => w.toggleMaximize());
      $('#wClose').addEventListener('click', () => w.close());
      // a full-screen section covers the top bar: the window's own strip comes up over it (the sections start under it)
      const wb = $('#winbar');
      wb.querySelector('[data-w="min"]').innerHTML = ic('minus');
      wb.querySelector('[data-w="close"]').innerHTML = ic('x');
      wb.addEventListener('click', (e) => {
        const b = e.target.closest('[data-w]');
        if (!b) return;
        if (b.dataset.w === 'min') w.minimize(); else if (b.dataset.w === 'max') w.toggleMaximize(); else w.close();
      });
      const wbMax = async () => {
        const on = await w.isMaximized(), b = wb.querySelector('[data-w="max"]');
        b.innerHTML = ic(on ? 'restoreWin' : 'square'); b.title = on ? 'Восстановить' : 'Развернуть'; b.setAttribute('aria-label', b.title);
      };
      wbMax(); w.onResized(wbMax);
      // the strip shows over whatever layer is on top (layers.js), with its title
      onLayers((top) => { wb.hidden = !top; if (top) $('#winbarT').textContent = 'Oddments · ' + top.title; });
    }).catch(() => {});
  }

  const dir = () => {
    $('#dirBtn').innerHTML = ic(S.dir < 0 ? 'arrowd' : 'arrowu');
    $('#dirBtn').title = S.dir < 0 ? 'По убыванию' : 'По возрастанию';
  };
  dir();

  const onSearch = debounce((v) => { S.q = v; S.sel.clear(); ui.refresh(); }, 90);
  // × in the field and Esc clear the query (audit 24.10: Esc only left the field, the query stayed)
  const qx = $('#qX');
  qx.innerHTML = ic('x');
  const clearQ = () => { $('#q').value = ''; qx.hidden = true; S.q = ''; ui.refresh(); };
  $('#q').addEventListener('input', (e) => { qx.hidden = !e.target.value; onSearch(e.target.value); });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); clearQ(); }
  });
  qx.addEventListener('click', () => { clearQ(); $('#q').focus(); });
  $('#sort').addEventListener('change', (e) => {
    S.sort = e.target.value;
    if (S.sort === 'ai') import('./lib/ai.js').then((ai) => { if (!ai.aiReady()) toast('Сортировка по смыслу работает с ИИ-поиском: включите его в Настройках › ИИ-поиск. Пока — по дате.'); });
    ui.refresh();
  });
  enhanceSelect($('#sort'));
  $('#dirBtn').addEventListener('click', () => { S.dir *= -1; dir(); ui.refresh(); });
  $('#lyM').addEventListener('click', () => reflow(() => { setLayoutPrefs({ layout: 'masonry' }); layoutGrid(true); }));
  $('#lyG').addEventListener('click', () => reflow(() => { setLayoutPrefs({ layout: 'grid' }); layoutGrid(true); }));
  // the size slider: the cards glide to their new places (body.reflow transitions) instead of jumping (bug #84)
  let zoomT = 0;
  $('#zoom').addEventListener('input', (e) => {
    if (motionOn()) { document.body.classList.add('reflow'); clearTimeout(zoomT); zoomT = setTimeout(() => document.body.classList.remove('reflow'), 520); }
    setLayoutPrefs({ zoom: +e.target.value }); layoutGrid(true);
  });
  $('#addBtn').addEventListener('click', pickFiles);
  $('#addDirBtn').addEventListener('click', pickFolder);
  $('#eagleBtn').addEventListener('click', () => import('./lib/importers.js').then((m) => m.importEagle()));
  $('#purBtn').addEventListener('click', () => import('./lib/importers.js').then((m) => m.importPureRef()));
  $('#flowBtn').addEventListener('click', () => import('./ui/flows.js').then((m) => m.flowFromDisk()));
  $('#matBtn').addEventListener('click', () => import('./ui/materials.js').then((m) => m.pickTextures()));
  $('#pasteBtn').addEventListener('click', pasteNow);
  // in the clean mode [ pins the sidebar that otherwise only slides in at the edge; pinned, it makes room for
  // itself like in the normal layout (laid over the wall it covered cards and the tabs)
  const togSide = () => reflow(() => { if (cleanOn()) { toggleCleanSide(); layoutGrid(true); } else setLayoutPrefs({ sideOff: !settings.sideOff }); });
  // the panel's own button: pins a panel that only peeked in at the edge, hides a pinned (or normal) one
  $('#sidePin').addEventListener('click', togSide);
  // the properties panel has nothing to show without a selection: the button waits until a file is picked
  const togInsp = () => { if (S.sel.size || isOverlayOpen()) reflow(() => setLayoutPrefs({ inspOff: !settings.inspOff })); };
  $('#sideTog').addEventListener('click', togSide);
  $('#inspTog').addEventListener('click', togInsp);
  bind.togSide = togSide; bind.togInsp = togInsp;
  $('#setBtn').addEventListener('click', () => { document.body.classList.remove('nav-open'); toggleSettings(); });
  // settings: focus goes into the drawer when it opens and back to the gear when it closes
  new MutationObserver(() => {
    const on = isSettingsOpen(), el = $('#settings');
    $('#setBtn').classList.toggle('on', on);
    $('#setBtn').setAttribute('aria-expanded', on);
    document.body.classList.toggle('set-open', on);
    if (on && !el.contains(document.activeElement)) { const x = $('#spX'); if (x) x.focus({ preventScroll: true }); }
    else if (!on && (el.contains(document.activeElement) || document.activeElement === document.body)) $('#setBtn').focus({ preventScroll: true });
  }).observe($('#settings'), { attributes: true, attributeFilter: ['class'] });
  // a click anywhere outside the drawer closes it (the gear toggles it itself; the drawer's own dropdown lists
  // and the palette live outside it in the DOM and do not count as «outside»); the click still does its job
  document.addEventListener('pointerdown', (e) => {
    if (!isSettingsOpen() || e.button !== 0) return;
    const t = e.target;
    if (!t.closest || t.closest('#settings, #setBtn, .gsel-list, .cmdk, .tst, .ob-tip')) return;
    $('#settings').classList.remove('on');
  }, true);
  $('#navBtn').addEventListener('click', () => document.body.classList.add('nav-open'));
  $('#navClose').addEventListener('click', () => document.body.classList.remove('nav-open'));

  // colour search popover (presets + wheel)
  $('#filtBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleColor(); });
  document.addEventListener('pointerdown', (e) => { if (isColorOpen() && !e.target.closest('#pop, #filtBtn')) closeColor(); });
  $('#simBtn').addEventListener('click', () => { const id = Array.from(S.sel)[0]; if (S.sel.size === 1) setView('similar', id); });
  $('#backBtn').addEventListener('click', () => { closeOverlays(); S.q = ''; S.color = null; $('#q').value = ''; setView('all'); });
  initHead({ newFolder, pick: pickFiles });
  $('#vAct').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="empty"]');
    if (b) import('./ui/hero.js').then((m) => m.emptyTrash(b));
  });

  initSidebar();
  initInspector();
  setLazySelection(selectionChanged);
  preloadLazy();
  // watch folders: new files from chosen folders come in by themselves (watch.js)
  import('./lib/watch.js').then((m) => m.initWatch((paths) => addPaths(paths, {}))).catch(() => {});
  // older files get the new palette (#79) from their thumbnails, in the background
  setTimeout(() => import('./lib/repalette.js').then((m) => m.refreshPalettes()).catch(() => {}), 6000);
  // the morning digest, when it is switched on (Новости › Сводка дня › «Собирать каждое утро»)
  try { if (JSON.parse(localStorage.getItem('perch.digest') || '{}').auto) import('./ui/news.js').then((m) => m.scheduleDigest()); } catch (e) { /* no prefs */ }

  // grid selection / preview / drag
  const grid = $('#grid'), scroll = $('#scroll');
  // Tab into the grid: put the keyboard cursor on the first card in view
  grid.addEventListener('focus', () => {
    if (!grid.matches(':focus-visible')) return;
    if (cursorIndex() < 0 && S.vis.length) { const j = firstInView(); if (j >= 0) setCursor(S.vis[j].id); }
    document.body.classList.add('kbd');
  });
  // a plain click on the card that is already the only selection deselects it (and the properties panel goes),
  // but only once the double-click time has passed: a double click still opens the picture. A drag (the
  // pointer moved) never counts as a click here.
  let down = null, unselT = 0;
  grid.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; }, true);
  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (!c) return;
    e.stopPropagation();
    const id = c.dataset.id;
    clearTimeout(unselT);
    const still = !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && still && S.sel.size === 1 && S.sel.has(id)) {
      if (e.detail === 1) unselT = setTimeout(() => { if (S.sel.size === 1 && S.sel.has(id)) { S.sel.clear(); selectionChanged(); } }, 320);
      return;
    }
    if (e.shiftKey && S.last) {
      const ids = S.vis.map((i) => i.id), a = ids.indexOf(S.last), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        if (!(e.ctrlKey || e.metaKey)) S.sel.clear();
        ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => S.sel.add(x));
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
      S.last = id;
    } else { S.sel = new Set([id]); S.last = id; }
    setCursor(id);
    selectionChanged();
  });
  initMarquee(selectionChanged);
  initContextMenu(selectionChanged);
  initSelBar(selectionChanged);
  grid.addEventListener('dblclick', (e) => { clearTimeout(unselT); const c = e.target.closest('.card'); if (c) openPreview(c.dataset.id); });
  scroll.addEventListener('click', (e) => { if (!e.target.closest('.card') && S.sel.size) { S.sel.clear(); selectionChanged(); } });
  grid.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.card');
    if (!c) return;
    if (!S.sel.has(c.dataset.id)) { S.sel = new Set([c.dataset.id]); selectionChanged(); }
    e.dataTransfer.setData('text/x-perch', JSON.stringify(Array.from(S.sel)));
    e.dataTransfer.effectAllowed = 'move';
  });

  // files / images dropped from Explorer or a browser
  let dc = 0;
  const ov = $('#dropOv');
  const external = (e) => e.dataTransfer && !Array.from(e.dataTransfer.types).includes('text/x-perch');
  window.addEventListener('dragenter', (e) => { if (external(e)) { dc++; ov.classList.add('on'); } });
  window.addEventListener('dragleave', (e) => { if (external(e)) { dc = Math.max(0, dc - 1); if (!dc) ov.classList.remove('on'); } });
  window.addEventListener('dragover', (e) => { if (external(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    dc = 0; ov.classList.remove('on');
    if (!external(e)) return;
    e.preventDefault();
    const row = e.target.closest && e.target.closest('[data-drop="folder"]');
    const ctx = row ? { folder: row.dataset.id } : ctxFromView();
    const types = Array.from(e.dataTransfer.types || []);
    // a dragged video link (from the address bar or a page) is the clip, not a picture from its page
    const vid = parseVideoUrl(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
    if (vid && !e.dataTransfer.files.length) { addVideoLink(vid, ctx); return; }
    const list = await extractFromTransfer(e.dataTransfer);
    if (list.length) addBlobs(list, ctx);
    else if (list.paths.length) addDropped(list.paths, ctx);
    // say what arrived: a source we do not read yet is then easy to tell apart
    else toast(`Не удалось получить картинку из перетаскивания (${list.err ? 'сайт ответил: ' + list.err : 'пришло: ' + (types.join(', ') || 'ничего')}). Скопируйте её (Ctrl C) и вставьте сюда — Ctrl V.`, 8000);
  });

  // Ctrl+V from anywhere (browser, Figma, screenshots, files)
  let pasteSeen = false;
  document.addEventListener('paste', async (e) => {
    if (isTyping(e.target)) return;
    pasteSeen = true;
    e.preventDefault();
    const dt = e.clipboardData;
    // a link to a Figma file: saved as a link card
    const fig = parseFigmaUrl(dt.getData('text/plain'));
    if (fig) { addBlobs([{ blob: urlShortcut(fig.url), name: fig.title + '.url', source: fig.url }], ctxFromView()); return; }
    const vid = parseVideoUrl(dt.getData('text/plain'));
    if (vid) { addVideoLink(vid, ctxFromView()); return; }
    let list = await extractFromTransfer(dt);
    const paths = list.paths || [];
    if (!list.length && !paths.length) list = await readNativeClipboardImage();
    if (list.length) addBlobs(list, ctxFromView());
    else if (paths.length) addDropped(paths, ctxFromView());
    // Figma's own copy carries layers, not pixels
    else if (figmaClipboard(dt)) toast('Это слои Figma, а не картинка. В Figma нажмите Ctrl+Shift+C («Копировать как PNG») и вставьте снова', 7000);
    else toast('В буфере обмена нет картинки. Скопируйте её (в Figma — Ctrl Shift C) и нажмите Ctrl V ещё раз.');
  });

  // preview
  $('#pvX').addEventListener('click', () => closePreview());
  $('#pvDrag').innerHTML = ic('grip');
  import('./lib/dragout.js').then((m) => m.bindDragOut($('#pv'), '#pvDrag', () => [S.byId.get(S.previewId)], () => toast('Перетаскивание в другие программы — в приложении Oddments'),
    () => toast('Зажмите ⠿ и перетащите файл в другую программу: Figma, Blender, PureRef, Проводник', 4500)));
  const moved = (id) => { setCursor(id); scrollToItem(id); selectionChanged(); };
  // the focus ring is for keyboard users only, like :focus-visible
  document.addEventListener('mousedown', () => document.body.classList.remove('kbd'), true);
  $('#pvS').addEventListener('click', (e) => {
    const n = e.target.closest('[data-nav]');
    if (n) stepPreview(+n.dataset.nav, moved);
    else if (e.target.id === 'pvS') closePreview();
  });

  // keyboard
  const previewKey = (e) => {
    if (e.key === 'Tab') { trapTab(e, $('#pv')); return; }
    if (e.key === 'Escape' || (e.key === ' ' && !isTyping(e.target))) { e.preventDefault(); closePreview(); }
    else if (e.key === 'ArrowRight' && !isTyping(e.target)) stepPreview(1, moved);
    else if (e.key === 'ArrowLeft' && !isTyping(e.target)) stepPreview(-1, moved);
    else if (['+', '=', '-', '0'].includes(e.key) && !e.ctrlKey && !isTyping(e.target) && zoomKey(e.key)) e.preventDefault();
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); import('./ui/ctxmenu.js').then((m) => m.openInApp(S.byId.get(S.previewId))); }
  };
  setPreviewKeys(previewKey);

  // the wall's shortcuts — one table with the «?» sheet (hotkeys.js); keys by their place (e.code) work in any layout
  const sel = () => S.sel.size > 0, notTrash = () => S.view.type !== 'trash';
  hotkey({ group: 'Сетка', keys: '← ↑ → ↓', what: 'по карточкам', hit: (e) => (NAV[e.key] || e.key === 'Home' || e.key === 'End') && plain(e) && S.vis.length > 0, run: (e) => { e.preventDefault(); navGrid(e.key, e.shiftKey); } });
  hotkey({ group: 'Сетка', keys: 'Shift + стрелки', what: 'выделить подряд' });
  hotkey({ group: 'Сетка', keys: 'Ctrl A', what: 'выделить всё', hit: (e) => mod(e) && e.code === 'KeyA', run: (e) => { e.preventDefault(); S.sel = new Set(S.vis.map((i) => i.id)); selectionChanged(); } });
  hotkey({ group: 'Сетка', keys: 'Пробел', what: 'просмотр', hit: (e) => e.key === ' ' && sel(), run: (e) => { e.preventDefault(); openPreview(focusedId()); } });
  hotkey({ group: 'Сетка', hit: (e) => e.key === 'Enter' && plain(e) && sel() && !e.target.closest('button, a, [role="button"]'), run: (e) => { e.preventDefault(); openPreview(focusedId()); } });
  // Ctrl+Enter: open in the file's own program (Photoshop for PSD, Blender for .blend…)
  hotkey({ group: 'Сетка', keys: 'Ctrl Enter', what: 'открыть в программе', hit: (e) => e.key === 'Enter' && mod(e) && S.sel.size === 1, run: (e) => { e.preventDefault(); import('./ui/ctxmenu.js').then((m) => m.openInApp(S.byId.get(Array.from(S.sel)[0]))); } });
  // F: add the selection to favourites (or remove, if it is all there already)
  hotkey({ group: 'Сетка', keys: 'F', what: 'в избранное', hit: (e) => e.code === 'KeyF' && plain(e) && sel(), run: () => {
    const items = selItems(), on = !items.every((i) => i.fav);
    items.forEach((i) => { i.fav = on; syncCard(i.id); });
    sfx(on ? 'fav' : 'unfav');
    saveIndex();
    toast(on ? 'В избранном: ' + items.length : 'Убрано из избранного: ' + items.length);
    if (S.view.type === 'fav') ui.refresh(); else { renderSide(); renderInsp(); }
  } });
  hotkey({ group: 'Сетка', keys: 'F2', what: 'переименовать', hit: (e) => e.key === 'F2' && sel() && notTrash(), run: (e) => { e.preventDefault(); openRename(selItems()); } });
  hotkey({ group: 'Сетка', keys: 'Delete', what: 'в корзину', hit: (e) => (e.key === 'Delete' || e.key === 'Backspace') && sel() && notTrash(), run: (e) => {
    e.preventDefault();
    const items = selItems();
    trashItems(items); S.sel.clear(); ui.refresh();
    toast('В корзину: ' + items.length, 0, { fn: () => { restoreItems(items); ui.refresh(); } });
  } });
  // the picture tools by one key, like F for favourites (audit 29.10: only the menu and the palette had them)
  hotkey({ group: 'Сетка', keys: 'B', what: 'убрать фон', hit: (e) => e.code === 'KeyB' && plain(e) && !e.shiftKey && sel() && notTrash(), run: () => {
    const pics = selItems().filter(isPic);
    if (pics.length) import('./ui/cutout.js').then((m) => m.openCutout(pics));
    else toast('Фон убирается с картинок и PSD — выберите картинку.');
  } });
  hotkey({ group: 'Сетка', keys: 'U', what: 'увеличить ×2 / ×4', hit: (e) => e.code === 'KeyU' && plain(e) && !e.shiftKey && sel() && notTrash(), run: () => {
    const it = selItems().find((i) => isPic(i) && i.ext !== 'svg');
    if (it) import('./ui/upscale.js').then((m) => m.openUpscale(it));
    else toast('Увеличиваются картинки и PSD (не SVG и не GIF) — выберите картинку.');
  } });
  hotkey({ group: 'Сетка', keys: 'Menu', what: 'меню карточки' });
  hotkey({ group: 'Сетка', keys: '/', what: 'поиск', hit: (e) => e.key === '/', run: (e) => { e.preventDefault(); $('#q').focus(); } });
  hotkey({ group: 'Добавить', keys: 'Ctrl V', what: 'вставить из буфера' });
  hotkey({ group: 'Добавить', keys: 'Ctrl Shift C', what: 'в Figma: копировать как PNG' });
  hotkey({ group: 'Окно', keys: isMac ? '⌘ K' : 'Ctrl Пробел', what: 'команды и поиск по всему' });
  hotkey({ group: 'Окно', keys: '[', what: 'боковая панель', hit: (e) => e.code === 'BracketLeft' && !mod(e), run: () => bind.togSide() });
  hotkey({ group: 'Окно', keys: ']', what: 'панель свойств', hit: (e) => e.code === 'BracketRight' && !mod(e), run: () => bind.togInsp() });
  hotkey({ group: 'Окно', keys: '\\', what: 'чистый экран', hit: (e) => e.code === 'Backslash' && !mod(e), run: () => reflow(() => setClean(!cleanOn())) });
  hotkey({ group: 'Окно', keys: '?', what: 'эта шпаргалка', hit: (e) => e.key === '?', run: (e) => { e.preventDefault(); import('./ui/keys.js').then((m) => m.toggleKeys()); } });
  document.addEventListener('keydown', (e) => {
    if (isPreviewOpen()) { previewKey(e); return; }
    if (layerOpen()) return; // a full-screen layer owns the keys (layers.js)
    if (isAskOpen()) { if (e.key === 'Escape') $('#dlgNo').click(); else trapTab(e, $('#dlg')); return; }
    if (isOverlayOpen() && !isTyping(e.target) && !(e.target.closest && e.target.closest('.insp, .side, #settings'))) {
      // the grid is hidden under the duplicates / «Разобрать»: only Esc (back) and the panel toggles apply
      if (e.key === 'Escape') { e.preventDefault(); if (isDupesOpen()) closeDupes(); else closeTidy(); }
      else if (e.code === 'BracketLeft' && !e.ctrlKey) bind.togSide();
      else if (e.code === 'BracketRight' && !e.ctrlKey) bind.togInsp();
      return;
    }
    if (e.key === 'Escape') {
      if (isQuickOpen()) closeQuick();
      else if ($('#settings').classList.contains('on')) $('#settings').classList.remove('on');
      else if (isColorOpen()) closeColor();
      else if (document.body.classList.contains('nav-open')) document.body.classList.remove('nav-open');
      else if (S.sel.size) { S.sel.clear(); selectionChanged(); }
      if (isTyping(e.target)) e.target.blur();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV' && !isTyping(e.target)) { // by the key's place: any layout
      pasteSeen = false;
      setTimeout(async () => {
        if (pasteSeen) return;
        const list = await readNativeClipboardImage();
        if (list.length) addBlobs(list, ctxFromView());
      }, 250);
      return;
    }
    if (isTyping(e.target)) return;
    runHotkey(e);
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) flushIndex(); });
  window.addEventListener('beforeunload', () => { flushIndex(); });
  // the tray menu (tray.rs): «Вставить из буфера» pastes like Ctrl+V; «Выход» saves the index first, then quits
  if (window.__TAURI_INTERNALS__) {
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('perch-tray-paste', () => pasteNow());
      listen('perch-quit', async () => {
        try { await flushIndex(); } catch (e) { /* quit anyway */ }
        (await import('@tauri-apps/api/core')).invoke('quit_app');
      });
    }).catch(() => {});
  }
}

/* ---------- boot ---------- */
// the first-run window: a computer where Oddments has never run (no settings yet), or one left halfway (the language
// was switched, which reloads); in the browser build only with ?welcome
function wantWelcome() {
  try {
    if (/[?&]welcome(?:[&=]|$)/.test(location.search)) return true;
    const w = localStorage.getItem('perch.welcome');
    if (w) return !JSON.parse(w).done;
    return !!window.__TAURI_INTERNALS__ && localStorage.getItem('perch.settings') == null;
  } catch (e) { return false; }
}
async function boot() {
  lockWindow(); // «Без сети»: nothing from other sites loads in the window (lib/net.js)
  const crashed = initCrashLog(); // errors go to the local report (lib/crashlog.js); true: the last run crashed
  const welcome = wantWelcome(); // read before loadSettings writes the first settings
  loadSettings();
  applySettings();
  await initI18n(); // English, when chosen: the dictionary loads (a Russian start skips it), then what the interface shows is translated
  // the first run: language, the library folder, AI and the network, before the library opens (ui/welcome.js)
  const firstRun = welcome ? await (await import('./ui/welcome.js')).runWelcome() : null;
  // the tray menu is drawn by the system, not the page: its words go to Rust (tray.rs starts in Russian)
  if (lang !== 'ru' && window.__TAURI_INTERNALS__) import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_tray_labels', { open: t('Открыть Oddments'), paste: t('Вставить из буфера'), quit: t('Выход') })).catch(() => {});
  bootIntro();
  document.body.classList.add('lib-loading'); // the header says «Открываю библиотеку…» until the index is read
  initFrame();
  initClean();
  bind();
  initGrid();
  initPixel();
  try {
    const lib = await initLibrary();
    if (lib.restored) setTimeout(() => toast(`Файл библиотеки index.json был повреждён — открыта резервная копия (${lib.restored.replace('backups/index-', 'от ').replace('.json', '').replace('index.json.bak', 'последняя')}). Повреждённый файл сохранён рядом.`, 12000), 1500);
    const root = getRoot();
    $('#libLabel').textContent = root.split(/[\\/]/).filter(Boolean).pop() || root;
    $('#libLabel').title = 'Папка библиотеки: ' + root;
  } catch (e) {
    document.body.classList.remove('lib-loading');
    bootDone();
    fatal(e && e.message ? e.message : String(e));
    return;
  }
  document.body.classList.remove('lib-loading');
  ui.refresh();
  bootDone();
  initSprings();
  initMotion();
  initGlide();
  initElastic();
  initPalette();
  initSound();
  // a screen that fails to load (a lazy chunk refused, a module throwing on import) says so instead of doing nothing
  // (bug #60: the icon constructor silently did not open in the exe)
  window.addEventListener('unhandledrejection', (e) => {
    const m = String((e.reason && (e.reason.message || e.reason)) || '');
    // a load cut short because the file changed under it (flipping files fast) is not an error (bug #123)
    if (e.reason && e.reason.name === 'AbortError') { e.preventDefault(); return; }
    if (/dynamically imported module|Failed to fetch|Importing a module|Content Security|unsafe-eval|is not defined|Cannot read/i.test(m)) {
      console.error(e.reason);
      toast('Раздел не открылся: ' + m.slice(0, 160), 9000);
    }
  });
  initOnboard();
  initAiBar();
  initShelf();
  renderShelf();
  initAi();
  if (firstRun) import('./ui/welcome.js').then((m) => m.after(firstRun)); // AI on, the Eagle import — as chosen
  import('./lib/team.js').then((m) => m.initTeams()).catch((e) => console.warn('team', e)); // shared folders of the team, if connected
  setTimeout(() => import('./lib/ocr.js').then((m) => { ocrMod = m; m.initOcr(); }), 5000);
  setTimeout(() => import('./lib/updater.js').then((m) => m.autoCheck()), 15000); // only when the person allowed it
  crashed.then((yes) => { if (yes) setTimeout(() => toast('В прошлый раз в Oddments случился сбой. Отчёт сохранён на этом компьютере — его можно скопировать и прислать.', 12000, { label: 'Скопировать отчёт', fn: () => import('./ui/settingsabout.js').then((m) => m.copyReport()) }), 2500); });
  import('./lib/mcp.js').then((m) => m.initMcp()); // Claude and other MCP clients: the library as tools
  import('./lib/meshjob.js').then((m) => m.initMeshJobs()); // SVG → 3D meshes for the Blender add-on (bridge /mesh)
  initBridge(addPaths, (url, ctx) => { const v = parseVideoUrl(url); return v && v.site === 'Pinterest' ? addVideoLink(v, ctx).then(() => true) : null; });
}
boot();
