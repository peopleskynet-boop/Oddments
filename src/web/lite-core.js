// @tauri-apps/api/core for Oddments Web: the library's files by address (lite-fs.js fileUrl — the service worker or a
// blob: address); there is no Rust here, so invoke refuses (the callers catch it, like in `npm run web`).
import { fileUrl } from './lite-fs.js';
export const convertFileSrc = (path) => fileUrl(path);
export const invoke = async (cmd) => { throw new Error('invoke недоступен в Oddments Web: ' + cmd); };
// tauri-plugin-drag imports it; there is no system drag here
export class Channel { constructor() { this.onmessage = null; } }
