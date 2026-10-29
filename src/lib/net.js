// «Без сети» (Settings › О программе › Приватность): one switch that stops everything Oddments would send out —
// model downloads, feeds, link previews, HDRIs, the API, the update check. Local things keep working: the library,
// the receiver for the add-on and the extension (127.0.0.1), Blender, models already on disk.
// Two locks: the app's own requests all pass nethttp.js (the plugin-http package is aliased to it), and what the
// window itself would load from a site (a picture, a clip, a YouTube player) is refused by a stricter CSP added at
// start. A CSP cannot be taken back, so turning the switch off reloads the window.
import { readPref, writePref } from './prefs.js';

const KEY = 'perch.net';
export const isOffline = () => readPref(KEY, { offline: false }).offline === true;

// one fixed sentence (the toast that shows it is translated whole): «Не удалось …: включён режим «Без сети» (…)»
export function offlineError() {
  const e = new Error('включён режим «Без сети» (Настройки › О программе)');
  e.name = 'OfflineError';
  return e;
}

// the window loads nothing from other sites: only the app's own files, the library (asset:) and blobs
export function lockWindow() {
  if (!isOffline() || document.getElementById('csp-offline')) return;
  const m = document.createElement('meta');
  m.id = 'csp-offline';
  m.httpEquiv = 'Content-Security-Policy';
  m.content = "img-src 'self' asset: http://asset.localhost blob: data:; media-src 'self' asset: http://asset.localhost blob:; frame-src 'none'";
  document.head.appendChild(m);
}

// off: the caller saves what is pending, then the window reloads without the stricter CSP
export function setOffline(on) {
  writePref(KEY, { ...readPref(KEY, {}), offline: !!on });
  if (on) lockWindow(); else location.reload();
}
