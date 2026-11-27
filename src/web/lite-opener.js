// @tauri-apps/plugin-opener for Oddments Web: a library file opens in a new tab (the browser shows or downloads it),
// a web address in a new tab; there is no file manager to show a file in.
import { fileUrl } from './lite-fs.js';
export async function openPath(path) { const u = fileUrl(path); if (u) window.open(u, '_blank', 'noopener'); else throw new Error('файла нет'); }
export async function openUrl(url) { window.open(url, '_blank', 'noopener'); }
export async function revealItemInDir() { throw new Error('В браузере нет Проводника'); }
