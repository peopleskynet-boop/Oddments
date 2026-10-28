// Screens of apps (src/lib/screens.js): guesses from the text, size and colours; a flow in numbers
import test from 'node:test';
import assert from 'node:assert/strict';
import { guessScreen, screenWords, flowStats } from '../../src/lib/screens.js';

test('the app named in the text is sure; a brand colour alone is only a maybe', () => {
  assert.deepEqual(guessScreen({ ocr: '9:41\nЯндекс Пэй\nКошелёк' }).app, { value: 'Яндекс Пэй', sure: true });
  assert.deepEqual(guessScreen({ ocr: 'Т-Банк\nКэшбэк' }).app, { value: 'Т-Банк', sure: true });
  assert.deepEqual(guessScreen({ ocr: 'T-Банк' }).app, { value: 'Т-Банк', sure: true }); // a Latin T from the text reader
  assert.deepEqual(guessScreen({ ocr: '', colors: ['#ffffff', '#fedd2c'] }).app, { value: 'Т-Банк', sure: false });
  assert.equal(guessScreen({ ocr: 'Привет', colors: ['#808080'] }).app, undefined);
});

test('platform: «9:41» says iOS, a known size hints at it', () => {
  assert.deepEqual(guessScreen({ ocr: '9:41\nГлавная' }).os, { value: 'ios', sure: true });
  assert.deepEqual(guessScreen({ ocr: '', w: 1179, h: 2556 }).os, { value: 'ios', sure: false });
  assert.deepEqual(guessScreen({ ocr: '', w: 1080, h: 2400 }).os, { value: 'android', sure: false });
  assert.deepEqual(guessScreen({ ocr: '', w: 1920, h: 1080 }).os, { value: 'web', sure: false });
});

test('kind of screen by its words; one short word is not enough', () => {
  assert.equal(guessScreen({ ocr: 'Перевод по номеру телефона\nПолучатель\nСБП' }).type.value, 'Перевод');
  assert.equal(guessScreen({ ocr: 'Кэшбэк\nКатегории повышенного кэшбэка\nБаллы' }).type.value, 'Кэшбэк');
  assert.equal(guessScreen({ ocr: 'Перевод' }).type, undefined);
});

test('search words and a flow in numbers', () => {
  assert.equal(screenWords({ app: 'ВТБ', os: 'android', type: 'Оплата', pat: ['Боттомшит'] }), 'ВТБ Android Оплата Боттомшит');
  const s = flowStats([{ flowT: 1 }, { flowT: 4.5, flowSig: [{ k: 'wait', s: 2 }] }, { flowT: 9, flowSig: [{ k: 'back', to: 1 }] }]);
  assert.deepEqual(s, { steps: 3, seconds: 8, waits: 1, waitSeconds: 2, backs: 1 });
});
