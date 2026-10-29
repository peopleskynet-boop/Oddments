// @tauri-apps/plugin-updater and plugin-process for the browser build: there is nothing to update, the check says so.
export async function check() { return null; }
export async function relaunch() { location.reload(); }
export async function exit() { /* the tab stays */ }
