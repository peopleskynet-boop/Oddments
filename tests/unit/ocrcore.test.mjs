// Text on pictures (src/lib/ocrcore.js): the pure parts — mixed alphabets, the CTC decoder, which lines are kept
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixScripts, goodLine, joinLines, ctcDecode } from '../../src/lib/ocrcore.js';

test('a word read in two alphabets comes back in one', () => {
  assert.equal(fixScripts('peфepeнc'), 'референс'); // ф and н are only Cyrillic
  assert.equal(fixScripts('Нello'), 'Hello'); // l is only Latin
  assert.equal(fixScripts('Кэшбэк 5%'), 'Кэшбэк 5%'); // a clean word stays as it is
  assert.equal(fixScripts('Dior'), 'Dior');
});

test('lines too unsure or too short are dropped', () => {
  assert.ok(goodLine({ conf: 0.9, text: 'Перевод' }));
  assert.ok(!goodLine({ conf: 0.6, text: 'Перевод' }));
  assert.ok(!goodLine({ conf: 0.99, text: 'x' }));
  assert.ok(goodLine({ conf: 0.8, text: '9:41' }));
});

test('boxes of one row join with spaces, rows with new lines', () => {
  const t = joinLines([{ row: 0, text: 'Кому бы' }, { row: 0, text: 'порекомендовали' }, { row: 2, text: 'MTC Деньги?' }]);
  assert.deepEqual(t.split('\n'), ['Кому бы порекомендовали', 'MTC Деньги?']);
});

test('CTC: repeats collapse, blanks separate letters', () => {
  const dict = ['а', 'б', 'в'];
  // classes: 0 blank, 1..3 the dictionary, 4 space; steps: а а _ б б _ б
  const seq = [1, 1, 0, 2, 2, 0, 2];
  const classes = dict.length + 2, out = new Float32Array(seq.length * classes);
  seq.forEach((c, t) => { out[t * classes + c] = 1; });
  const [r] = ctcDecode(out, 1, seq.length, classes, dict);
  assert.equal(r.text, 'абб');
  assert.ok(r.conf > 0.99);
});
