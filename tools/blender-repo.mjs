// The Blender add-on as an extension repository, without Blender (for CI):
//   node tools/blender-repo.mjs <out dir>   → <out>/oddments-<version>.zip and <out>/index.json
// Every published release of the public repository carries both, so
// https://github.com/peopleskynet-boop/Oddments/releases/latest/download/index.json is a remote repository for Blender
// (Preferences › Get Extensions › Repositories › Add Remote Repository): install and updates from Blender itself.
// The package is what `blender --command extension build` makes (tools/blender_extension.py does it with Blender and
// validates it): __init__.py (integrations/blender/perch_blender.py) and blender_manifest.toml at the root of a deflate
// zip. The version comes from bl_info in the add-on, as in that script. The zip is the same for the same files (fixed
// dates), so its hash does not change between runs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// the small part of TOML a Blender manifest uses: `key = "string"` or `key = ["a", "b"]`, [tables], # comments
export function parseManifest(text) {
  const out = {};
  let table = out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#[^"\]]*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const t = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (t) { table = out[t[1]] = {}; continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) throw new Error('blender_manifest.toml: не разобрать строку «' + raw + '»');
    try { table[kv[1]] = JSON.parse(kv[2].replace(/,\s*\]$/, ']')); } catch (e) { throw new Error('blender_manifest.toml: значение «' + kv[1] + '» — не строка и не список строк'); }
  }
  return out;
}

export const addonVersion = (src) => {
  const m = src.match(/"version":\s*\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error('perch_blender.py: в bl_info нет версии');
  return m.slice(1).join('.');
};

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// a deflate zip of [name, bytes] at its root; every entry dated 2026-01-01 00:00 (DOS time)
export function zip(files) {
  const DATE = ((2026 - 1980) << 9) | (1 << 5) | 1, TIME = 0;
  const parts = [], dir = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameB = Buffer.from(name, 'utf8'), packed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(TIME, 10); head.writeUInt16LE(DATE, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameB.length, 26); head.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(TIME, 12); cen.writeUInt16LE(DATE, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20);
    cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameB.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(head, nameB, packed);
    dir.push(cen, nameB);
    offset += head.length + nameB.length + packed.length;
  }
  const dirB = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirB.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dirB, end]);
}

// the repository's index.json: the manifest's fields without [build], and where the package is, its size and hash
export function repoIndex(manifest, pkgName, pkg) {
  const { build, ...fields } = manifest;
  return {
    version: 'v1', blocklist: [],
    data: [{ ...fields, archive_url: './' + pkgName, archive_size: pkg.length, archive_hash: 'sha256:' + createHash('sha256').update(pkg).digest('hex') }],
  };
}

// the package of the add-on as it is in the repository; the manifest's version follows bl_info
export function buildPackage(addonSrc, manifestText) {
  const version = addonVersion(addonSrc.toString('utf8'));
  const text = manifestText.replace(/^version = "[^"]*"/m, `version = "${version}"`);
  const manifest = parseManifest(text);
  const name = `${manifest.id}-${version}.zip`;
  const pkg = zip([['blender_manifest.toml', Buffer.from(text, 'utf8')], ['__init__.py', addonSrc]]);
  return { name, pkg, index: repoIndex(manifest, name, pkg), version, synced: text === manifestText };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] || join(ROOT, 'dist-blender', 'repo');
  const src = readFileSync(join(ROOT, 'integrations', 'blender', 'perch_blender.py'));
  const r = buildPackage(src, readFileSync(join(ROOT, 'integrations', 'blender', 'blender_manifest.toml'), 'utf8'));
  if (!r.synced) console.warn(`blender_manifest.toml: версия приведена к bl_info (${r.version}) — запустите tools/blender_extension.py, чтобы обновить файл`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, r.name), r.pkg);
  writeFileSync(join(out, 'index.json'), JSON.stringify(r.index, null, 2) + '\n');
  console.log(`${r.name}: ${r.pkg.length} bytes, ${r.index.data[0].archive_hash}`);
}
