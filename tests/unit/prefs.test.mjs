// Preferences (src/lib/prefs.js): a read never throws and keeps the shape of its defaults
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
let full = false;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
};
const { readPref, writePref, readText } = await import('../../src/lib/prefs.js');

test('defaults when nothing is stored', () => {
  assert.deepEqual(readPref('a', { on: true }), { on: true });
  assert.deepEqual(readPref('a', []), []);
  assert.equal(readPref('a', 5), 5);
});

test('stored fields over the defaults; a missing field gets its default (watch folders broke on {} without dirs)', () => {
  store.set('w', '{}');
  assert.deepEqual(readPref('w', { dirs: [] }), { dirs: [] });
  store.set('w', '{"dirs":["C:/x"],"extra":1}');
  assert.deepEqual(readPref('w', { dirs: [] }), { dirs: ['C:/x'], extra: 1 });
});

test('broken JSON or the wrong shape falls back to the defaults', () => {
  store.set('b', '{oops');
  assert.deepEqual(readPref('b', { on: false }), { on: false });
  store.set('b', '[1,2]');
  assert.deepEqual(readPref('b', { on: false }), { on: false });
  store.set('b', '{"a":1}');
  assert.deepEqual(readPref('b', []), []);
});

test('the defaults object is never handed out itself', () => {
  const d = { list: 1 };
  const r = readPref('none', d);
  r.list = 2;
  assert.equal(d.list, 1);
});

test('a full storage makes a write report false instead of throwing', () => {
  full = true;
  assert.equal(writePref('x', { a: 1 }), false);
  full = false;
  assert.equal(writePref('x', { a: 1 }), true);
  assert.deepEqual(readPref('x', {}), { a: 1 });
  assert.equal(readText('nothing', 'def'), 'def');
});
