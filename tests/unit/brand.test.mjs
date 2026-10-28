// «Проверка по бренду» (src/lib/brand.js): the palette against the team's colours; a model against its limits
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPalette, checkModelRules, DEFAULT_RULES } from '../../src/lib/brand.js';

test('an on-brand render: some red, the rest neutral', () => {
  const r = checkPalette(['#ffffff', '#ff0033', '#1d2023'], [0.6, 0.15, 0.25]);
  assert.equal(r[0].level, 'ok');
});

test('too little or too much of the brand colour', () => {
  assert.match(checkPalette(['#ffffff', '#1d2023'], [0.8, 0.2])[0].text, /мало: 0 %/);
  assert.match(checkPalette(['#ff0032', '#ffffff'], [0.7, 0.3])[0].text, /слишком много: 70 %/);
});

test('a saturated colour not in the palette, and a forbidden one', () => {
  const r = checkPalette(['#ffffff', '#ff0032', '#00a0ff'], [0.6, 0.1, 0.3]);
  assert.ok(r.some((x) => /не из палитры: #00A0FF/.test(x.text)));
  const f = checkPalette(['#ffffff', '#ff0032', '#ffdd2d'], [0.7, 0.1, 0.2], { ...DEFAULT_RULES, forbid: ['#ffdd2d'] });
  assert.ok(f.some((x) => x.level === 'err' && /Запрещённый/.test(x.text)));
});

test('greys are never off-brand', () => {
  const r = checkPalette(['#777777', '#ff0032', '#ffffff'], [0.5, 0.1, 0.4]);
  assert.equal(r[0].level, 'ok');
});

test('model: polygons, UV, size, default names', () => {
  const r = checkModelRules({ tris: 320000, uvless: 2, size: [120, 3, 4], materials: 2, objects: ['Cube.001', 'Кнопка'], materialNames: ['Material'] });
  const t = r.map((x) => x.text).join(' | ');
  assert.match(t, /лимит команды 150 000/);
  assert.match(t, /Без UV: 2/);
  assert.match(t, /Размер 120\.0 м/);
  assert.match(t, /Cube\.001, Material/);
  assert.equal(checkModelRules({ tris: 5000, uvless: 0, size: [0.5, 0.5, 0.5], materials: 1, objects: ['Кнопка'] })[0].level, 'ok');
});
