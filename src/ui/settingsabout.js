// Settings › «О программе»: the version and updates, privacy and «Без сети», the crash report, licences. Loads with the
// drawer (settings.js), not at start.
import { $, dateFmt } from '../util.js';
import { closeSettings } from './settings.js';
import { toast } from './dialogs.js';
import { flushIndex, getRoot } from '../lib/library.js';
import { S } from '../state.js';
import { aiOn, aiEngine } from '../lib/ai.js';
import { isOffline, setOffline } from '../lib/net.js';

const PRIVACY = 'https://github.com/peopleskynet-boop/Oddments/blob/main/docs/privacy.md';

export async function bindAbout() {
  const up = await import('../lib/updater.js');
  const st = $('#sUpdSt');
  if (!st) return;
  const v = await up.appVersion();
  $('#sVer').textContent = v || 'веб-версия';
  const auto = $('#sUpdAuto');
  auto.checked = up.autoUpdates();
  auto.onchange = () => { up.setAutoUpdates(auto.checked); if (auto.checked) up.checkUpdates({ quiet: true }); };
  const show = () => {
    if (!document.body.contains(st)) { off(); return; }
    const s = up.updateState();
    st.textContent = s.running ? 'Проверяю…'
      : s.pending ? `Доступна версия ${s.pending}`
      : s.last ? `Последняя проверка: ${dateFmt.format(new Date(s.last))}`
      : 'Ещё не проверялось';
    $('#sUpdGo').hidden = !s.pending;
    $('#sUpdNow').disabled = s.running;
  };
  const off = up.onUpdate(show);
  show();
  $('#sUpdNow').onclick = () => up.checkUpdates();
  $('#sUpdGo').onclick = () => up.installUpdate();
  // «Без сети»: on at once; off reloads the window (lib/net.js — the stricter CSP cannot be taken back)
  const offBox = $('#sOffline');
  offBox.checked = isOffline();
  offBox.onchange = async () => {
    if (!offBox.checked) { try { await flushIndex(); } catch (e) { /* saved on every change anyway */ } }
    setOffline(offBox.checked);
    if (offBox.checked) toast('Без сети: Oddments ничего не скачивает и не отправляет. Всё, что уже на компьютере, работает.', 6000);
  };
  $('#sPrivDoc').onclick = () => import('@tauri-apps/plugin-opener').then((m) => m.openUrl(PRIVACY)).catch(() => window.open(PRIVACY, '_blank'));
  // the crash report (lib/crashlog.js): how much is there, copy it, the folder, clear
  const cl = await import('../lib/crashlog.js');
  const showLog = async () => {
    const n = await cl.logStats();
    const el = $('#sCrashSt');
    if (el) el.textContent = n.errors || n.crashes ? `Ошибок окна: ${n.errors} · сбоев программы: ${n.crashes}` : 'Ошибок не записано';
  };
  showLog();
  $('#sCrashCopy').onclick = () => copyReport();
  $('#sCrashOpen').onclick = () => cl.openLogs().catch((e) => toast('Не удалось открыть папку: ' + ((e && e.message) || e)));
  $('#sCrashClear').onclick = async () => { await cl.clearLogs(); showLog(); toast('Отчёт очищен'); };
  $('#sLic').onclick = () => import('./licenses.js').then((m) => { closeSettings(); m.openLicenses(); });
  $('#sUpdNotes').onclick = () => import('@tauri-apps/plugin-opener').then((m) => m.openUrl(up.RELEASES)).catch(() => window.open(up.RELEASES, '_blank'));
}

// the report into the clipboard: the version, the system, the library's size, the last errors — no personal paths
export async function copyReport() {
  const [cl, up] = await Promise.all([import('../lib/crashlog.js'), import('../lib/updater.js')]);
  const text = await cl.buildReport({
    version: await up.appVersion(), items: S.items.filter((i) => !i.trashed).length, root: getRoot(),
    extra: [`AI: ${aiOn() ? aiEngine() : 'off'} · offline: ${isOffline() ? 'yes' : 'no'} · lang: ${document.documentElement.lang || '-'}`],
  });
  try { await navigator.clipboard.writeText(text); toast('Отчёт скопирован — вставьте его в письмо или сообщение'); }
  catch (e) {
    try { (await import('@tauri-apps/plugin-clipboard-manager')).writeText(text); toast('Отчёт скопирован — вставьте его в письмо или сообщение'); }
    catch (e2) { toast('Не удалось скопировать отчёт: ' + ((e2 && e2.message) || e2) + '. Откройте папку и приложите файлы из неё.', 8000); }
  }
}
