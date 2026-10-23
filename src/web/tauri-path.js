// @tauri-apps/api/path for the browser build.
export const sep = () => '/';
export const documentDir = async () => '/Documents';
export const appLocalDataDir = async () => '/AppLocalData';
export const join = async (...parts) => parts.join('/').replace(/\/+/g, '/');
