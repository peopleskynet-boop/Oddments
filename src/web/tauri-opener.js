// @tauri-apps/plugin-opener for the browser build.
import { urlFor } from './memfs.js';
export async function openPath(path) { const u = urlFor(path); if (u) window.open(u, '_blank'); }
export async function openUrl(url) { window.open(url, '_blank'); }
export async function revealItemInDir(path) { console.info('[web] показать в проводнике:', path); }
