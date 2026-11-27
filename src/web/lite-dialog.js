// @tauri-apps/plugin-dialog for Oddments Web: a hidden <input type=file>. What is picked is kept in memory under
// /picked/<n>/… (lite-fs.js keep) and those paths are returned, so library.js imports it like files from a disk.
import { keep } from './lite-fs.js';

let n = 0;
export function open(opts = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = !!opts.multiple || !!opts.directory;
    if (opts.directory) inp.webkitdirectory = true;
    const ext = (opts.filters || []).flatMap((f) => f.extensions || []);
    if (ext.length && !ext.includes('*')) inp.accept = ext.map((e) => '.' + e).join(',');
    inp.style.display = 'none';
    document.body.appendChild(inp);
    const done = (v) => { inp.remove(); resolve(v); };
    inp.onchange = () => {
      const list = Array.from(inp.files || []);
      if (!list.length) return done(null);
      const base = '/picked/' + ++n;
      const paths = list.map((f) => { const p = base + '/' + (f.webkitRelativePath || f.name); keep(p, f); return p; });
      if (opts.directory) done(base + '/' + (list[0].webkitRelativePath || '').split('/')[0]);
      else done(opts.multiple ? paths : paths[0]);
    };
    inp.addEventListener('cancel', () => done(null));
    inp.click();
  });
}
export const save = async () => null;
export const message = async (m) => { alert(m); };
export const ask = async (m) => window.confirm(m);
export const confirm = async (m) => window.confirm(m);
