// Updates of Oddments itself (tauri-plugin-updater). Every published release of the public repository carries
// latest.json (the release-manifest workflow writes it from the installers' .sig files); the check reads that one
// file from github.com — nothing about the person or the library goes with it. The update is signed with the
// project's key (the public half is in tauri.conf.json), so a swapped file is refused before it is installed.
// The check runs only when the person allowed it (the first-run window, the one-time offer or Settings › «О
// программе»), never in «Без сети», at most once a day; «Проверить сейчас» asks right away.
import { readPref, writePref } from './prefs.js';
import { isOffline } from './net.js';
import { flushIndex } from './library.js';
import { busy, busyDone, toast } from '../ui/dialogs.js';
import { sfx } from '../ui/sound.js';
import { t } from './i18n.js';

const KEY = 'perch.updates';
const DAY = 20 * 3600e3; // «once a day», with room for a computer that starts at slightly different hours
export const RELEASES = 'https://github.com/peopleskynet-boop/Oddments/releases';
const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// auto: null — not decided yet (no checks), true / false — the person's choice; offered: the one-time toast was shown
const prefs = () => readPref(KEY, { auto: null, last: 0, offered: false, found: '' });
const save = (patch) => writePref(KEY, { ...prefs(), ...patch });
export const autoUpdates = () => prefs().auto === true;
export const setAutoUpdates = (on) => save({ auto: !!on, offered: true });
export const foundVersion = () => prefs().found;

let version = '';
export async function appVersion() {
  if (version || !inApp()) return version;
  try { version = await (await import('@tauri-apps/api/app')).getVersion(); } catch (e) { /* unknown */ }
  return version;
}

let pending = null, running = null;
const subs = new Set();
export const onUpdate = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const tell = () => subs.forEach((fn) => { try { fn(); } catch (e) { /* a closed screen */ } });
export const updateState = () => ({ pending: pending ? pending.version : '', running: !!running, last: prefs().last });

// Ask github.com for latest.json. quiet: the daily check says nothing unless there is a new version.
export async function checkUpdates({ quiet = false } = {}) {
  if (!inApp()) { if (!quiet) toast('Обновления — в приложении Oddments'); return null; }
  if (isOffline()) { if (!quiet) toast('Включён режим «Без сети» — обновления не проверяются. Выключить: Настройки › О программе.', 6000); return null; }
  if (running) return running;
  running = (async () => {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const up = await check({ timeout: 30000 });
      save({ last: Date.now(), found: up ? up.version : '' });
      pending = up || null;
      if (up) offer(up);
      else if (!quiet) toast('У вас последняя версия Oddments' + (version ? ' — ' + version : ''));
      return up;
    } catch (e) {
      // a release without latest.json yet (it is written a minute after publishing) reads as «no update» for the daily check
      // the reason comes from the plugin in English: each Russian piece is translated on its own (t), the sentence is not
      if (!quiet) toast(t('Не удалось проверить обновления:') + ' ' + reason(e) + t('. Проверьте интернет или скачайте установщик со страницы выпусков.'), 8000);
      return null;
    } finally { running = null; tell(); }
  })();
  tell();
  return running;
}

const reason = (e) => String((e && e.message) || e || 'нет ответа').slice(0, 140);

function offer(up) {
  sfx('done');
  toast(`Есть новая версия Oddments — ${up.version}`, 20000, { label: 'Установить', fn: () => installUpdate() });
}

// Download with progress in the busy pill, save the index, install. On Windows the installer closes Oddments and
// starts it again by itself; on the Mac the new app replaces the old one and Oddments restarts.
export async function installUpdate() {
  const up = pending || (await checkUpdates({ quiet: true }));
  if (!up) { toast('Новой версии нет — у вас последняя'); return; }
  let total = 0, got = 0;
  busy(`Скачиваю Oddments ${up.version}…`);
  try {
    await up.download((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength || 0;
      else if (ev.event === 'Progress') {
        got += ev.data.chunkLength;
        busy(total ? `Скачиваю Oddments ${up.version}: ${Math.round(got / 1e6)} из ${Math.round(total / 1e6)} МБ` : `Скачиваю Oddments ${up.version}…`, total ? got / total : -1);
      }
    });
    busy('Устанавливаю обновление…');
    try { await flushIndex(); } catch (e) { /* the index is saved on every change anyway */ }
    await up.install();
    busyDone();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    busyDone();
    console.error('update', e);
    toast(t('Не удалось обновить Oddments:') + ' ' + reason(e) + t('. Скачайте установщик со страницы выпусков.'), 12000, { label: 'Открыть', fn: () => import('@tauri-apps/plugin-opener').then((m) => m.openUrl(RELEASES)) });
  }
}

// a few seconds after the start: the daily check when allowed; otherwise, once, a quiet offer to allow it
export async function autoCheck() {
  if (!inApp()) return;
  await appVersion();
  const p = prefs();
  if (p.auto === true) { if (Date.now() - p.last > DAY) checkUpdates({ quiet: true }); return; }
  if (p.auto === null && !p.offered && !isOffline()) {
    save({ offered: true });
    toast('Oddments может сам проверять обновления: раз в день, один запрос к GitHub без данных о вас', 15000, { label: 'Включить', fn: () => { setAutoUpdates(true); checkUpdates({ quiet: true }); } });
  }
}
