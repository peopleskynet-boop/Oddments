// The English interface (src/lib/i18n.js) with the real dictionary: whole strings, templates, and the cuts that pick the
// most complete translation — and the person's own words left as they are
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build, tr } from '../../src/lib/i18n.js';

build(JSON.parse(fs.readFileSync(new URL('../../src/lib/i18n-en.json', import.meta.url), 'utf8')));

const cases = [
  ['Фон: Свет от картинок', 'Background: Light from the pictures'], // «{0} картинок» used to win and leave Russian
  ['155 файлов, выбрано 1', '155 files, 1 selected'],
  ['248 Б', '248 B'],
  ['Действуют правила: по умолчанию.', 'Rules in force: default.'],
  ['Красный #FF453A', 'Red #FF453A'],
  ['Капсула (C)', 'Capsule (C)'],
  ['Убрать все лишние (76)', 'Remove all extra (76)'],
  ['3 файла', '3 files'],

];
test('translates whole strings, templates and their pieces', () => {
  for (const [ru, en] of cases) assert.equal(tr(ru), en, ru);
});
test('the dash-joined title of a 3D mode is translated part by part', () => {
  assert.doesNotMatch(tr('Рендер (1) — модель со своими материалами и текстурами'), /[А-Яа-яЁё]/);
});
test('the person\'s own words stay: a file name is not a key with a colour or a shortcut', () => {
  assert.equal(tr('Тишина 135'), 'Тишина 135');
  assert.equal(tr('Мой референс'), 'Мой референс');
});
test('spaces around are kept', () => {
  assert.equal(tr('  3 файла '), '  3 files ');
});
