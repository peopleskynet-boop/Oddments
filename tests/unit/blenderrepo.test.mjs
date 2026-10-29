// The Blender add-on as an extension repository (tools/blender-repo.mjs): the manifest, the zip, index.json
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { parseManifest, addonVersion, zip, buildPackage } from '../../tools/blender-repo.mjs';

const MANIFEST = `schema_version = "1.0.0"
id = "oddments"
version = "1.0.0"
tags = ["Import-Export", "UV"]
blender_version_min = "5.2.0"  # a comment
license = ["SPDX:GPL-3.0-or-later"]

[permissions]
network = "127.0.0.1 only"

[build]
paths_exclude_pattern = ["__pycache__/"]
`;

// the files of a zip, read back from its central directory
function unzip(b) {
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = b.readUInt32LE(end + 16);
  const out = {};
  for (let n = b.readUInt16LE(end + 10); n--;) {
    const size = b.readUInt32LE(p + 20), len = b.readUInt16LE(p + 28), off = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + len);
    const data = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    out[name] = inflateRawSync(b.subarray(data, data + size));
    p += 46 + len;
  }
  return out;
}

test('the manifest: strings, lists, tables, comments', () => {
  const m = parseManifest(MANIFEST);
  assert.equal(m.blender_version_min, '5.2.0');
  assert.deepEqual(m.tags, ['Import-Export', 'UV']);
  assert.deepEqual(m.permissions, { network: '127.0.0.1 only' });
  assert.ok(m.build);
});

test('the version comes from bl_info', () => {
  assert.equal(addonVersion('bl_info = {\n    "version": (1, 22, 0),\n}'), '1.22.0');
  assert.throws(() => addonVersion('no bl_info'), /версии/);
});

test('the zip holds the files as they are', () => {
  const files = unzip(zip([['a.toml', Buffer.from('x = "1"')], ['__init__.py', Buffer.from('print("привет")')]]));
  assert.deepEqual(Object.keys(files), ['a.toml', '__init__.py']);
  assert.equal(files['__init__.py'].toString('utf8'), 'print("привет")');
});

test('the package and index.json: version from the add-on, no [build], size and hash of the zip', () => {
  const r = buildPackage(Buffer.from('bl_info = {"version": (1, 22, 0)}'), MANIFEST);
  assert.equal(r.name, 'oddments-1.22.0.zip');
  assert.equal(r.synced, false);
  const e = r.index.data[0];
  assert.equal(e.version, '1.22.0');
  assert.equal('build' in e, false);
  assert.equal(e.archive_url, './oddments-1.22.0.zip');
  assert.equal(e.archive_size, r.pkg.length);
  assert.match(e.archive_hash, /^sha256:[0-9a-f]{64}$/);
  assert.match(unzip(r.pkg)['blender_manifest.toml'].toString('utf8'), /version = "1\.22\.0"/);
  assert.deepEqual(buildPackage(Buffer.from('bl_info = {"version": (1, 22, 0)}'), MANIFEST).pkg, r.pkg); // the same bytes each time
});
