// A team library's journals folded together (src/lib/teamlog.js): order by time, later wins, nobody's journal overwrites
import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, safeRel } from '../../src/lib/teamlog.js';

const add = (t, by, id, extra = {}) => ({ t, by, op: 'add', item: { id, name: id, file: `files/${id}/a.png`, tags: [], ...extra } });

test('two people adding at once: both files are there, each with its author', () => {
  const items = fold([add(2, 'anna', 'b'), add(1, 'ivan', 'a')], 'T');
  assert.deepEqual(items.map((i) => [i.id, i.by, i.team]), [['a', 'ivan', 'T'], ['b', 'anna', 'T']]);
});

test('a later change wins, whoever wrote it, in whichever journal', () => {
  const items = fold([
    add(1, 'ivan', 'a'),
    { t: 5, by: 'anna', op: 'set', id: 'a', f: { tags: ['онбординг'] } },
    { t: 3, by: 'ivan', op: 'set', id: 'a', f: { tags: ['старт'], name: 'Экран' } },
  ], 'T');
  assert.deepEqual(items[0].tags, ['онбординг']);
  assert.equal(items[0].name, 'Экран');
});

test('only shared fields change; a removal hides the file for everyone', () => {
  const items = fold([add(1, 'ivan', 'a'), { t: 2, by: 'x', op: 'set', id: 'a', f: { file: '../../evil', fav: true } }, { t: 3, by: 'x', op: 'del', id: 'a' }], 'T');
  assert.equal(items[0].file, 'files/a/a.png');
  assert.equal(items[0].fav, false);
  assert.equal(items[0].trashed, true);
});

test('a change to a file nobody added, or a second add of the same id, changes nothing', () => {
  const items = fold([{ t: 1, op: 'set', id: 'z', f: { name: 'x' } }, add(2, 'ivan', 'a', { name: 'first' }), add(3, 'anna', 'a', { name: 'second' })], 'T');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'first');
});

test('a file path out of the team folder is refused', () => {
  const items = fold([add(1, 'x', 'a', { file: '../../Windows/x.png' }), add(2, 'x', 'b', { thumb: 'files/b/../../../x.webp' }), add(3, 'x', 'c')], 'T');
  assert.deepEqual(items.map((i) => i.id), ['b', 'c']);
  assert.equal(items[0].thumb, null);
  const bs = String.fromCharCode(92);
  assert.equal(safeRel('files/a/x.png'), true);
  assert.equal(safeRel(`files/a/b${bs}..${bs}x.png`), false);
  assert.equal(safeRel('files/a/C:x.png'), false);
});
