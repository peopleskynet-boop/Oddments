// @tauri-apps/api/core for the browser build.
import { urlFor } from './memfs.js';
export const convertFileSrc = (path) => urlFor(path);
export const invoke = async (cmd) => { throw new Error('invoke недоступен в веб-версии: ' + cmd); };
// tauri-plugin-drag imports it; in the browser there is no system drag (dragout.js does not start one)
export class Channel { constructor() { this.onmessage = null; } }
