// Oddments Web's zip (src/web/lite-zip.js): the library out and back in — what it writes reads back byte for byte,
// a zip made elsewhere (deflated, as Windows and macOS make it) opens, the library is found one folder down
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { crc32, zipBlob, readZip, entryBlob, libraryPrefix } from '../../src/web/lite-zip.js';

const enc = new TextEncoder();
const bytes = (n, seed) => { const u = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; u[i] = x >>> 24; } return u; };

test('CRC-32 of the usual check string', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  // in pieces, the same
  const all = bytes(5000, 7);
  assert.equal(crc32(all.subarray(3000), crc32(all.subarray(0, 3000))), crc32(all));
});

test('written and read back: names (Cyrillic too), sizes, contents', async () => {
  const files = [
    { name: 'index.json', blob: new Blob([JSON.stringify({ version: 1, folders: [], items: [{ id: 'a' }] })]) },
    { name: 'files/a/Постер.png', blob: new Blob([bytes(70000, 1)]) },
    { name: 'files/a/thumb.webp', blob: new Blob([bytes(1234, 2)]) },
    { name: 'files/b/empty.txt', blob: new Blob([]) },
  ];
  const seen = [];
  const zip = await zipBlob(files, (d, t) => seen.push([d, t]));
  assert.ok(seen.length && seen[seen.length - 1][0] === seen[seen.length - 1][1], 'progress reaches the total');
  const entries = await readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), files.map((f) => f.name));
  for (const f of files) {
    const e = entries.find((x) => x.name === f.name);
    const got = new Uint8Array(await (await entryBlob(zip, e)).arrayBuffer());
    assert.deepEqual(got, new Uint8Array(await f.blob.arrayBuffer()), f.name);
    assert.equal(e.crc, crc32(got));
  }
  // the system's own reader agrees (node:zlib has no zip reader: the central directory is checked above, the data here)
  assert.equal(entries[1].method, 0);
});

// a zip as Windows Explorer makes it: deflated entries, the library inside a folder
function deflatedZip(list) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, data] of list) {
    const n = enc.encode(name), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    parts.push(h, n, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(list.length, 8); e.writeUInt16LE(list.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Blob([...parts, cd, e]);
}

test('a deflated zip of the desktop folder opens, the library one level down', async () => {
  const idx = enc.encode(JSON.stringify({ version: 1, folders: [], items: [] }));
  const pic = bytes(40000, 3);
  const zip = deflatedZip([['Oddments Library/index.json', idx], ['Oddments Library/files/x/a.png', pic], ['Oddments Library/backups/index-2026-11-15.json', idx]]);
  const entries = await readZip(zip);
  assert.equal(libraryPrefix(entries), 'Oddments Library/');
  const got = new Uint8Array(await (await entryBlob(zip, entries[1])).arrayBuffer());
  assert.deepEqual(got, pic);
});

test('where the library sits: the shallowest index.json, not one in backups or files', () => {
  const e = (n) => ({ name: n });
  assert.equal(libraryPrefix([e('files/a/index.json'), e('index.json')]), '');
  assert.equal(libraryPrefix([e('backups/index.json'), e('My/files/index.json')]), null);
  assert.equal(libraryPrefix([e('__MACOSX/x/index.json'), e('Lib/index.json')]), 'Lib/');
  assert.equal(libraryPrefix([e('a.png')]), null);
});

test('not a zip: a clear refusal', async () => {
  await assert.rejects(readZip(new Blob([bytes(500, 9)])), /не zip/);
});
