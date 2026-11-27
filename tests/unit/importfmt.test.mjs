// Importing from Eagle and PureRef (src/lib/importfmt.js): Eagle's folders and records, pictures found inside a .pur
import test from 'node:test';
import assert from 'node:assert/strict';
import { eagleFolders, eagleItem, eagleOriginal, scanImages, boardMeta, boardFolder } from '../../src/lib/importfmt.js';

test('Eagle folders come parents first', () => {
  const f = eagleFolders({ folders: [{ id: 'A', name: 'Плакаты', children: [{ id: 'B', name: 'Швейцарский стиль', children: [] }] }, { id: 'C', name: '3D' }] });
  assert.deepEqual(f, [{ id: 'A', name: 'Плакаты', parent: null }, { id: 'B', name: 'Швейцарский стиль', parent: 'A' }, { id: 'C', name: '3D', parent: null }]);
  assert.deepEqual(eagleFolders({}), []);
});

test('an Eagle record becomes Oddments fields; the star is left behind', () => {
  const ids = new Map([['A', 'f1'], ['B', 'f2']]);
  const it = eagleItem({
    id: 'K1', name: 'Poster', ext: 'jpg', tags: ['swiss', 'swiss', ' type '], folders: ['B', 'gone'], annotation: 'Хорошая сетка',
    comments: [{ annotation: 'вот тут' }], url: 'https://example.com/p', btime: 1700000000000, star: 5,
  }, ids);
  assert.deepEqual(it, { name: 'Poster', tags: ['swiss', 'type'], folders: ['f2'], note: 'Хорошая сетка\n\nвот тут', url: 'https://example.com/p', added: 1700000000000, eagle: 'K1' });
  assert.equal('star' in it, false);
  assert.equal(eagleItem({ id: 'K2', isDeleted: true }, ids), null);
  const bare = eagleItem({ id: 'K3', url: 'javascript:alert(1)' }, ids);
  assert.equal(bare.url, '');
  assert.equal('name' in bare, false); // the file's own name stays
  assert.equal('added' in bare, false);
});

test('the original of an .info folder, not the thumbnail', () => {
  assert.equal(eagleOriginal(['metadata.json', 'Poster_thumbnail.png', 'Poster.jpg'], { name: 'Poster', ext: 'jpg' }), 'Poster.jpg');
  assert.equal(eagleOriginal(['metadata.json', 'x_thumbnail.png', 'other.PNG'], { name: 'x', ext: 'png' }), 'other.PNG');
  assert.equal(eagleOriginal(['metadata.json'], { name: 'x', ext: 'png' }), null);
});

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
const png = () => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', new Array(13).fill(1)), ...chunk('IDAT', [1, 2, 3, 0xff, 0xd8, 0xff]), ...chunk('IEND', [])];
const seg = (m, data) => [0xff, m, ((data.length + 2) >> 8) & 255, (data.length + 2) & 255, ...data];
const jpeg = () => [0xff, 0xd8, ...seg(0xe0, new Array(14).fill(0)), ...seg(0xc0, new Array(9).fill(1)), ...seg(0xda, new Array(6).fill(0)),
  5, 6, 0xff, 0x00, 7, 0xff, 0xd0, 8, 9, 0xff, 0xd9];

test('pictures inside a PureRef file are found whole, in order', () => {
  const a = png(), j = jpeg();
  const junk = [0, 1, 0xff, 0xd8, 0xff, 3, 4, 0x89, 0x50, 9];
  const bytes = Uint8Array.from([...junk, ...a, 7, 7, ...j, ...junk]);
  const found = scanImages(bytes);
  assert.deepEqual(found.map((f) => f.type), ['png', 'jpg']);
  assert.equal(found[0].start, junk.length);
  assert.equal(found[0].end - found[0].start, a.length);
  assert.equal(found[1].end - found[1].start, j.length);
});

test('a cut-off picture is not taken', () => {
  const a = png();
  assert.deepEqual(scanImages(Uint8Array.from(a.slice(0, a.length - 6))), []);
});

test('a board import from the extension: its JSON in `folder`, anything else is not one', () => {
  const m = boardMeta(JSON.stringify({ path: [['pinterest', 'Pinterest'], ['pinterest:board:9', ' Posters '], ['x', '']], src: 'pinterest:pin:1', note: 'Swiss' }));
  assert.deepEqual(m, { path: [['pinterest', 'Pinterest'], ['pinterest:board:9', 'Posters']], src: 'pinterest:pin:1', note: 'Swiss' });
  assert.equal(boardMeta('f123'), null);
  assert.equal(boardMeta(''), null);
  assert.equal(boardMeta('{broken'), null);
  assert.equal(boardMeta(JSON.stringify({ path: [] })), null);
});

test('board collections: found by key, else by name under the parent, else made', () => {
  let n = 0;
  const id = () => 'n' + ++n;
  const folders = [{ id: 'own', name: 'Pinterest', parent: null }];
  const a = boardFolder([['pinterest', 'Pinterest'], ['pinterest:board:9', 'Posters']], folders, id);
  assert.equal(folders.length, 2);
  assert.deepEqual(folders[1], { id: a, name: 'Posters', parent: 'own', open: false, src: 'pinterest:board:9' });
  // renamed in Oddments: still the same collection, by its key
  folders[1].name = 'Плакаты';
  assert.equal(boardFolder([['pinterest', 'Pinterest'], ['pinterest:board:9', 'Posters']], folders, id), a);
  // a section goes under its board
  const s = boardFolder([['pinterest', 'Pinterest'], ['pinterest:board:9', 'Posters'], ['pinterest:section:3', 'Swiss']], folders, id);
  assert.equal(folders.find((f) => f.id === s).parent, a);
  assert.equal(folders.length, 3);
});
