// @tauri-apps/api/path for Oddments Web: the library is /lib (lite-fs.js, the handle of lite-store.js); the app's own
// data folder is memory for the session (/app).
export const sep = () => '/';
export const documentDir = async () => '/docs';
export const appLocalDataDir = async () => '/app';
export const appDataDir = async () => '/app';
export const tempDir = async () => '/tmp';
export const join = async (...parts) => parts.join('/').replace(/\/+/g, '/');
export const basename = async (p) => String(p).split('/').filter(Boolean).pop() || '';
