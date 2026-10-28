// Personal data in the text of screenshots (src/lib/pii.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { piiTypes, piiRegions } from '../../src/lib/pii.js';

test('a real card number is found, random 16 digits are not', () => {
  assert.deepEqual(piiTypes('Карта 4276 3800 1234 5674'), []); // fails Luhn
  assert.deepEqual(piiTypes('Карта 4111 1111 1111 1111'), ['card']);
  assert.deepEqual(piiTypes('5469380012345674'.replace(/4$/, '7')), piiTypes('x')); // still nothing
  assert.deepEqual(piiTypes('Дебетовая •• 4417'), ['card']);
});

test('phones in the usual Russian forms and abroad', () => {
  for (const p of ['+7 (916) 123-45-67', '8 916 123 45 67', '+79161234567', 'Перевод по номеру +7 916 123-45-67']) assert.deepEqual(piiTypes(p), ['phone'], p);
  assert.deepEqual(piiTypes('+44 20 7946 0958'), ['phone']);
  assert.deepEqual(piiTypes('Код из СМС 123456'), []);
});

test('names: a known first name or a patronymic; ordinary capitalised words are not names', () => {
  assert.deepEqual(piiTypes('Иван Петров'), ['name']);
  assert.deepEqual(piiTypes('Анна С.'), ['name']);
  assert.deepEqual(piiTypes('Петров Сергей Николаевич'), ['name']);
  assert.deepEqual(piiTypes('IVAN PETROV'), ['name']);
  assert.deepEqual(piiTypes('Мои Финансы'), []);
  assert.deepEqual(piiTypes('Перевод Себе'), []);
  assert.deepEqual(piiTypes('MASTER CARD'), []);
});

test('accounts, e-mail, passport', () => {
  assert.deepEqual(piiTypes('Счёт 40817 810 0 9999 1234567'), ['account']);
  assert.deepEqual(piiTypes('40817810099991234567'), ['account']);
  assert.deepEqual(piiTypes('ivan.petrov@mail.ru'), ['email']);
  assert.deepEqual(piiTypes('Паспорт 45 12 345678'), ['passport']);
});

test('sums are hidden but do not mark the picture', () => {
  assert.equal(piiRegions([{ x: 0, y: 0, w: 1, h: 0.05, text: 'Баланс 12 345,67 Р' }])[0].kind, 'sum'); // ₽ read as Р
  assert.deepEqual(piiTypes('Баланс 12 345,67 ₽'), []);
  const r = piiRegions([{ x: 0, y: 0.1, w: 1, h: 0.05, text: 'Баланс 12 345,67 ₽' }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'sum');
  assert.equal(piiRegions([{ x: 0, y: 0, w: 1, h: 0.05, text: 'Баланс 12 345,67 ₽' }], { sums: false }).length, 0);
});

test('a region covers the matched part of its line, not the whole line', () => {
  const [r] = piiRegions([{ x: 0.1, y: 0.5, w: 0.8, h: 0.04, text: 'Получатель: Иван Петров' }]);
  assert.equal(r.kind, 'name');
  assert.ok(r.x > 0.1 + 0.8 * 0.4, 'starts after «Получатель:»');
  assert.ok(r.x + r.w <= 0.9 + 1e-9);
  assert.equal(r.y, 0.5);
});

test('one find is not counted twice as two kinds', () => {
  const r = piiRegions([{ x: 0, y: 0, w: 1, h: 0.1, text: '4111 1111 1111 1111' }]);
  assert.deepEqual(r.map((x) => x.kind), ['card']);
});

test('edges move to the real gaps between words: a first digit left outside the estimate is taken in', async () => {
  const { snapToGaps } = await import('../../src/lib/pii.js');
  // «Карта» 0–50, gap, «4111» 62–100, gap, «1111» 110–150; the estimate started at 66 — the «4» stayed outside
  const ink = new Uint8Array(150).map((_, x) => (x < 50 || (x >= 62 && x < 100) || x >= 110 ? 1 : 0));
  const [a, b] = snapToGaps(ink, 66, 150, 20);
  assert.ok(a <= 62 && a >= 50, `left edge ${a} in the gap before «4111»`);
  assert.equal(b, 150);
  // an estimate that ran into the label comes back to the gap after the label
  const [a2] = snapToGaps(ink, 40, 150, 20);
  assert.ok(a2 < 50, 'a label partly covered stays covered (never less than the estimate)');
});
