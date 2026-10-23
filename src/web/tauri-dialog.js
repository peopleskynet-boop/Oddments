// @tauri-apps/plugin-dialog for the browser build: a hidden <input type=file>.
// Picked files are copied into the in-memory FS under /picked and their paths returned.
import { mem } from './memfs.js';

let n = 0;
export function open(opts = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = !!opts.multiple || !!opts.directory;
    if (opts.directory) inp.webkitdirectory = true;
    inp.onchange = () => {
      const list = Array.from(inp.files || []);
      if (!list.length) return resolve(null);
      const base = '/picked/' + ++n;
      const paths = list.map((f) => {
        const p = base + '/' + (f.webkitRelativePath || f.name);
        mem.put(p, f);
        return p;
      });
      if (opts.directory) resolve(base + '/' + (list[0].webkitRelativePath || '').split('/')[0]);
      else resolve(opts.multiple ? paths : paths[0]);
    };
    inp.addEventListener('cancel', () => resolve(null));
    inp.click();
  });
}
export const save = async () => null;
export const message = async (m) => { alert(m); };
export const ask = async (m) => confirm(m);
export const confirm = async (m) => window.confirm(m);
