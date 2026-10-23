// @tauri-apps/plugin-clipboard-manager for the browser build.
// readImage has no native fallback here: the browser paste event already carries the image.
export async function readImage() { throw new Error('нет системного буфера в веб-версии'); }
export const readText = () => navigator.clipboard.readText();
export const writeText = (t) => navigator.clipboard.writeText(t);
export async function writeImage() { throw new Error('недоступно в веб-версии'); }
