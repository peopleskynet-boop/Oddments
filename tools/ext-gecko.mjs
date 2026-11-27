// The browser extension for Zen and Firefox: integrations/browser with the Gecko manifest (src/lib/extgecko.js),
// packed as dist-ext/oddments-<version>-gecko.xpi — unsigned. In Zen: about:config › xpinstall.signatures.required =
// false, then about:addons › ⚙ › «Установить дополнение из файла». Run: node tools/ext-gecko.mjs [--dir]
// (--dir also leaves the unpacked folder dist-ext/gecko, for about:debugging › «Загрузить временное дополнение»).
import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { geckoManifest, geckoSkips } from '../src/lib/extgecko.js';

const src = path.resolve('integrations/browser');
const out = path.resolve('dist-ext');
const files = {};
const walk = (dir, rel = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r);
    else if (!geckoSkips(r)) files[r] = new Uint8Array(fs.readFileSync(path.join(dir, e.name)));
  }
};
walk(src);
const manifest = geckoManifest(JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')));
files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
fs.mkdirSync(out, { recursive: true });
const xpi = path.join(out, `oddments-${manifest.version}-gecko.xpi`);
fs.writeFileSync(xpi, zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') }));
if (process.argv.includes('--dir')) {
  const dir = path.join(out, 'gecko');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [r, bytes] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, r)), { recursive: true }); fs.writeFileSync(path.join(dir, r), bytes); }
}
console.log(xpi, Object.keys(files).length, 'files');
