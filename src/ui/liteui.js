// Oddments Web's own screens (src/lib/lite.js; loaded only in the lite build): the start — the service worker (the app
// offline, the library's files by address), where the library lives and the folder's permission —, «Библиотека» in
// Настройки (in the browser / a folder on disk, the zip there and back), «Установить», the new-build toast.
import './lite.css';
import { S, ui } from '../state.js';
import { $, esc, fmtSize, plural } from '../util.js';
import { ic } from './icons.js';
import { toast, choose, busy, busyDone } from './dialogs.js';
import * as store from '../web/lite-store.js';
import * as fs from '../web/lite-fs.js';
import { zipBlob, readZip, entryBlob, libraryPrefix } from '../web/lite-zip.js';
import { absPath, flushIndex, releaseLibrary, isReadOnly } from '../lib/library.js';
import { LOCK_FILE } from '../lib/liblock.js';
import { SHARE } from '../lib/lite.js';

/* ---------- start ---------- */
let reg = null;
async function startWorker() {
  if (!('serviceWorker' in navigator)) return;
  fs.serveFiles();
  try {
    reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (!navigator.serviceWorker.controller) {
      // Shift+F5 skips the worker for that one load: a plain reload brings it back (once)
      if (reg.active && !sessionStorage.getItem('odd.swReload')) {
        sessionStorage.setItem('odd.swReload', '1');
        location.reload();
        await new Promise(() => {});
      }
      await Promise.race([
        new Promise((res) => navigator.serviceWorker.addEventListener('controllerchange', res, { once: true })),
        new Promise((res) => setTimeout(res, 6000)),
      ]);
    }
    sessionStorage.removeItem('odd.swReload');
    if (navigator.serviceWorker.controller) fs.useWorker(new URL('./__odd/fs', location.href).href);
    watchUpdates();
  } catch (e) { console.warn('[lite] service worker', e); }
}

// a newer build installed next to this one: it takes over when the person says so (the running page keeps its chunks)
function watchUpdates() {
  const offer = (w) => {
    if (!w || !navigator.serviceWorker.controller) return;
    toast('Вышла новая версия Oddments Web', 0, { label: 'Обновить', fn: () => {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      w.postMessage({ type: 'odd-update' });
    } });
  };
  if (reg.waiting) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
  });
  setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
}

// Before the library opens: the worker, then where the library lives. A folder opened before needs its permission again
// after the browser forgot it — one click on the start card (a user gesture is needed for the browser's prompt).
export async function liteBoot() {
  document.body.classList.add('lite');
  // a shared link: no worker, no install, no library of this browser — the link's own, read from its address
  if (SHARE) { document.body.classList.add('share'); await store.openStore(); return; }
  listenInstall(); // the browser offers the install early — often before the library has opened
  await startWorker();
  const r = await store.openStore();
  if (r.ask) {
    const v = await choose(`Библиотека в папке «${r.ask}»`, 'Браузер спрашивает разрешение на папку заново, когда вкладки Oddments Web закрывали. Файлы на месте.',
      [{ label: 'Библиотека в браузере', value: 'opfs' }, { label: `Открыть «${r.ask}»`, value: 'folder', pri: true }]);
    let ok = false;
    if (v === 'folder') { try { ok = await store.grantFolder(r.handle); } catch (e) { console.warn('[lite] permission', e); } }
    if (!ok) {
      await store.openBrowserStore();
      if (v === 'folder') setTimeout(() => toast('Браузер не дал доступ к папке — открыта библиотека в браузере. Папку можно открыть снова: Настройки › Библиотека.', 9000), 1200);
    }
  }
  // the browser's own library can only be held by a tab of this browser: a gone tab's mark is free at once (liblock.js)
  ui.lockLocal = store.storeMode() !== 'folder';
  if (store.storeMode() === 'memory') setTimeout(() => toast('Этот браузер не даёт хранить файлы (приватное окно?): библиотека проживёт до закрытия вкладки. Перед уходом скачайте её: Настройки › Библиотека.', 14000), 1600);
}

// After the library opened: its name under the sidebar, the files the wall shows (without a worker), the install button
export async function liteLoaded() {
  if (SHARE) { await (await import('./sharebar.js')).mountShareBar(); return; }
  const label = $('#libLabel');
  const where = whereText();
  if (label) { label.textContent = where.short; label.title = where.long; }
  const paths = S.items.flatMap((i) => [i.thumb, i.preview].filter(Boolean)).map((p) => absPath(p));
  await fs.warm(paths);
  if (S.items.length) store.keepStorage();
  initInstall();
}

function whereText() {
  const m = store.storeMode();
  if (m === 'folder') return { short: `Папка «${store.storeName()}»`, long: `Библиотека в папке на диске «${store.storeName()}» — её же открывает настольный Oddments` };
  if (m === 'opfs') return { short: 'В этом браузере', long: 'Библиотека хранится в этом браузере (на этом компьютере)' };
  return { short: 'Только эта вкладка', long: 'Браузер не даёт хранить файлы: библиотека проживёт до закрытия вкладки' };
}

/* ---------- «Установить» ---------- */
// beforeinstallprompt comes when the browser decides the page is installable — kept from the very start (listenInstall),
// the button (initInstall, once the sidebar is there) shows it then or later
let deferred = null;
const showInstall = () => { if (initInstall.show) initInstall.show(); };
function listenInstall() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; showInstall(); });
  window.addEventListener('appinstalled', () => { deferred = null; showInstall(); toast('Oddments Web установлен — он откроется своим окном'); });
}
function initInstall() {
  const foot = document.querySelector('.side-foot');
  if (!foot || foot.querySelector('.lt-inst')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'pill ghost lt-inst'; b.hidden = true;
  b.innerHTML = `${ic('download')}<span>Установить</span>`;
  b.title = 'Oddments Web своим окном, с работой без сети';
  foot.appendChild(b);
  b.addEventListener('click', install);
  initInstall.show = () => { b.hidden = !deferred; const s = $('#sLtInst'); if (s) s.hidden = !deferred; };
  initInstall.show();
}
async function install() {
  if (!deferred) return;
  const e = deferred;
  deferred = null;
  showInstall();
  try { await e.prompt(); await e.userChoice; } catch (err) { console.warn('[lite] install', err); }
}

/* ---------- Настройки › Библиотека ---------- */
export async function bindLiteSettings(box) {
  if (!box) return;
  const m = store.storeMode(), w = whereText(), info = m === 'opfs' ? await store.storageInfo() : null;
  const used = info ? ` · занято ${fmtSize(info.used)}${info.quota ? ` из ${fmtSize(info.quota)}` : ''}` : '';
  const kept = info ? (info.kept ? 'Браузер не сотрёт её, даже когда на диске мало места.' : 'Когда на диске совсем мало места, браузер может её стереть — держите копию: «Скачать библиотеку».') : '';
  box.innerHTML = `<span>Где лежит: <b>${esc(w.short)}</b>${used}</span>
    <small class="hint">${m === 'folder' ? 'Та же папка открывается в настольном Oddments: index.json и files/ — общие. Работать в ней можно в одном месте сразу — второе только смотрит.' : m === 'opfs' ? kept : esc(w.long) + '.'}</small>
    <div class="int-acts">${store.canPickFolder() ? `<button class="ibtn" data-lt="folder">${m === 'folder' ? 'Открыть другую папку…' : 'Открыть папку библиотеки…'}</button>` : ''}${m === 'folder' ? '<button class="ibtn" data-lt="browser">Вернуться к библиотеке в браузере</button>' : ''}<button class="ibtn pri" id="sLtInst" data-lt="install" hidden>Установить Oddments Web</button></div>
    <small class="hint">${store.canPickFolder() ? 'Перенос с настольным Oddments: откройте здесь его папку («Документы › Oddments Library») — или скачайте библиотеку целиком и распакуйте архив в папку, которую открывает настольный.' : 'Перенос с настольным Oddments: скачайте библиотеку целиком и распакуйте архив в папку, которую открывает настольный; в обратную сторону — заархивируйте его папку и откройте архив здесь. Папку на диске напрямую открывают Chrome и Edge.'}</small>
    <div class="int-acts"><button class="ibtn" data-lt="zip">Скачать библиотеку целиком</button><button class="ibtn" data-lt="unzip">Открыть библиотеку из zip…</button></div>`;
  showInstall();
  box.onclick = (e) => {
    const b = e.target.closest('[data-lt]');
    if (!b) return;
    const a = b.dataset.lt;
    if (a === 'folder') openFolder();
    else if (a === 'browser') backToBrowser();
    else if (a === 'install') install();
    else if (a === 'zip') downloadLibrary();
    else if (a === 'unzip') openZip();
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function reopen() {
  try { await flushIndex(); } catch (e) { /* saved on every change */ }
  await releaseLibrary();
  location.reload();
}

// «Открыть папку библиотеки…»: a folder on disk becomes the library. An empty one can take the browser's library along;
// a folder with other things in it is asked about first (index.json and files/ will appear there).
async function openFolder() {
  let h;
  try { h = await store.pickFolder(); } catch (e) { toast('Не удалось открыть папку: ' + ((e && e.message) || e)); return; }
  if (!h) return;
  let hasIndex = false, others = 0;
  for await (const x of h.values()) { if (x.name === 'index.json' && x.kind === 'file') hasIndex = true; else if (!x.name.startsWith('.') && x.name !== LOCK_FILE) others++; }
  let move = false;
  if (!hasIndex) {
    const mine = S.items.filter((i) => !i.trashed).length;
    if (mine && store.storeMode() === 'opfs') {
      const v = await choose(`Папка «${h.name}» — библиотека`, `В ней пока нет библиотеки Oddments. Перенести туда библиотеку из браузера (${mine} ${plural(mine, ['файл', 'файла', 'файлов'])}) или начать в папке пустую? В браузере всё останется как есть.`,
        [{ label: 'Начать пустую', value: 'empty' }, { label: 'Перенести', value: 'move', pri: true }]);
      if (!v) return;
      move = v === 'move';
    } else if (others) {
      const v = await choose(`Папка «${h.name}»`, 'В ней нет библиотеки Oddments, но есть другие файлы. Сделать её библиотекой? Внутри появятся index.json и папка files — остальное Oddments не тронет.', [{ label: 'Сделать библиотекой', value: 'go', pri: true }]);
      if (!v) return;
    }
  }
  if (move) {
    try { await flushIndex(); await copyTree(store.libDir(), h); } catch (e) { busyDone(''); toast('Не удалось перенести библиотеку в папку: ' + ((e && e.message) || e) + '. Библиотека в браузере не изменилась.'); return; }
  }
  await store.rememberFolder(h);
  await reopen();
}
async function backToBrowser() {
  await store.forgetFolder();
  await reopen();
}

// the browser's library into a folder on disk, file by file (the mark of this window stays behind)
async function copyTree(from, to) {
  const list = [];
  const collect = async (d, pre) => { for await (const x of d.values()) { if (!pre && (x.name === LOCK_FILE || x.name.endsWith('.tmp'))) continue; if (x.kind === 'directory') await collect(x, pre + x.name + '/'); else list.push({ h: x, rel: pre + x.name }); } };
  await collect(from, '');
  let done = 0;
  for (const f of list) {
    const parts = f.rel.split('/'), name = parts.pop();
    let d = to;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(await f.h.getFile());
    await w.close();
    busy(`Переношу библиотеку · ${++done} из ${list.length}`, done / list.length);
  }
  busyDone(`Перенесено: ${list.length}`);
}

/* ---------- zip there and back ---------- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10 * 60 * 1000);
}
const today = () => new Date().toISOString().slice(0, 10);

// «Скачать библиотеку целиком»: index.json and files/ — what the desktop app opens once unpacked into its folder
export async function downloadLibrary() {
  try {
    await flushIndex();
    busy('Собираю архив…');
    const entries = [];
    const walk = async (dir, rel) => {
      for (const x of await fs.readDir(dir)) {
        const p = dir + '/' + x.name, r = rel + x.name;
        if (x.isDirectory) await walk(p, r + '/');
        else entries.push({ name: r, blob: await fs.readBlob(p) });
      }
    };
    // index.json is copied into memory: the archive's other parts stay files on disk, and a File of the browser's storage
    // stops reading once the file is written again — the index is, at every change made while the download runs
    entries.push({ name: 'index.json', blob: new Blob([JSON.stringify({ version: 1, folders: S.folders, items: S.items })], { type: 'application/json' }) });
    if (await fs.exists(absPath('files'))) await walk(absPath('files'), 'files/');
    const zip = await zipBlob(entries, (d, t) => busy(`Собираю архив · ${fmtSize(d)} из ${fmtSize(t)}`, t ? d / t : -1));
    download(zip, `Oddments Library ${today()}.zip`);
    busyDone(`Архив готов: ${fmtSize(zip.size)}`);
  } catch (e) { busyDone(''); toast('Не удалось собрать архив: ' + ((e && e.message) || e)); }
}

// the menu's «Экспорт в zip…»: the chosen files' originals, with readable names (lib/exporter.js names them)
export async function zipItems(items, names, title) {
  try {
    busy('Собираю архив…');
    const entries = [];
    for (let k = 0; k < items.length; k++) entries.push({ name: names[k], blob: await fs.readBlob(absPath(items[k].file)) });
    const zip = await zipBlob(entries, (d, t) => busy(`Собираю архив · ${fmtSize(d)} из ${fmtSize(t)}`, t ? d / t : -1));
    download(zip, (title || 'Oddments').replace(/[\\/:*?"<>|]+/g, '_') + '.zip');
    busyDone(`Экспортировано: ${items.length}`);
  } catch (e) { busyDone(''); toast('Экспорт не удался: ' + ((e && e.message) || e)); }
}

const safeRel = (r) => r && !r.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(r) && !/[\\:]/.test(r) && (r === 'index.json' || r.startsWith('files/'));
const pickZip = () => new Promise((res) => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.zip,application/zip'; inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.onchange = () => { inp.remove(); res((inp.files || [])[0] || null); };
  inp.addEventListener('cancel', () => { inp.remove(); res(null); });
  inp.click();
});

// «Открыть библиотеку из zip…»: a downloaded library (or the desktop app's folder, zipped) becomes the browser's library
export async function openZip() {
  if (isReadOnly() && store.storeMode() === 'opfs') { toast('Библиотеку в браузере сейчас открыла другая вкладка — откройте архив там.', 7000); return; }
  if (!store.hasOpfs()) { toast('Этот браузер не даёт хранить файлы (приватное окно?) — архив некуда распаковать.', 7000); return; }
  const file = await pickZip();
  if (!file) return;
  let entries, prefix, data;
  try {
    busy('Читаю архив…');
    entries = await readZip(file);
    prefix = libraryPrefix(entries);
    if (prefix == null) throw new Error('в архиве нет index.json — это не библиотека Oddments');
    data = JSON.parse(await (await entryBlob(file, entries.find((e) => e.name === prefix + 'index.json'))).text());
    if (!data || !Array.isArray(data.items)) throw new Error('index.json в архиве не читается как библиотека');
    busyDone('');
  } catch (e) { busyDone(''); toast('Не удалось открыть архив: ' + ((e && e.message) || e) + '.', 8000); return; }
  const n = data.items.filter((i) => !i.trashed).length, mine = S.items.filter((i) => !i.trashed).length;
  const v = await choose('Открыть библиотеку из архива?', `В архиве ${n} ${plural(n, ['файл', 'файла', 'файлов'])}. Она займёт место библиотеки в этом браузере` +
    (store.storeMode() === 'opfs' && mine ? ` — сейчас в ней ${mine} ${plural(mine, ['файл', 'файла', 'файлов'])}; если они нужны, сначала скачайте её.` : '.') +
    (store.storeMode() === 'folder' ? ` Папка «${store.storeName()}» не изменится: Oddments Web перейдёт на библиотеку в браузере.` : ''),
  [{ label: 'Открыть', value: 'go', pri: true }]);
  if (!v) return;
  const todo = entries.filter((e) => e.name.startsWith(prefix)).map((e) => ({ e, rel: e.name.slice(prefix.length) })).filter((x) => safeRel(x.rel));
  try {
    await releaseLibrary();
    if (store.storeMode() === 'folder') await store.forgetFolder();
    await store.clearOpfs();
    const total = todo.reduce((s, x) => s + x.e.size, 0);
    let done = 0;
    for (const x of todo) {
      await fs.writeFile(fs.LIB + '/' + x.rel, await entryBlob(file, x.e));
      done += x.e.size;
      busy(`Распаковываю · ${fmtSize(done)} из ${fmtSize(total)}`, total ? done / total : -1);
    }
    busyDone('Библиотека открыта');
    await sleep(400);
    location.reload();
  } catch (e) { busyDone(''); toast('Не удалось распаковать архив: ' + ((e && e.message) || e) + '. Откройте его ещё раз.', 9000); }
}

ui.liteWhere = whereText;
