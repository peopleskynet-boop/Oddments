// @tauri-apps/plugin-http behind «Без сети» (lib/net.js): vite.config.js points the package's name here, so every
// request the app makes to a site — feeds, models, link previews, the API — goes through this one fetch, and none
// leaves while the switch is on. The real plugin (or the browser build's stand-in) is «tauri-http-real».
import { fetch as realFetch } from 'tauri-http-real';
import { isOffline, offlineError } from './net.js';

export async function fetch(input, init) {
  if (isOffline()) throw offlineError();
  return realFetch(input, init);
}
