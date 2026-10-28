// The team's tag dictionary (src/lib/glossary.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, suggest, similarTags } from '../../src/lib/glossary.js';

const G = { 'онбординг': ['onboarding', 'онбординги'], 'боттомшит': ['bottom sheet', 'bottomsheet', 'шторка'] };

test('a synonym or the same word typed differently becomes the dictionary word', () => {
  assert.equal(canonical('Onboarding', G), 'онбординг');
  assert.equal(canonical('#Онбординг ', G), 'онбординг');
  assert.equal(canonical('шторка', G), 'боттомшит');
  assert.equal(canonical('Кэшбэк', G), 'Кэшбэк'); // not in the dictionary: kept as typed
});

test('suggestions: the dictionary first, by its synonyms too', () => {
  assert.deepEqual(suggest('onb', G, ['onboarding-old']), ['онбординг', 'onboarding-old']);
  assert.deepEqual(suggest('што', G), ['боттомшит']);
});

test('tags that are one word written differently are proposed for merging', () => {
  const m = similarTags([['Онбординг', 3], ['онбординг', 5], ['onboarding', 2], ['кэшбэк', 4], ['Кешбэк', 1], ['перевод', 9]], G);
  assert.deepEqual(m[0], { keep: 'онбординг', merge: ['Онбординг', 'onboarding'], n: 10 });
  assert.deepEqual(m[1], { keep: 'кэшбэк', merge: ['Кешбэк'], n: 5 });
  assert.equal(m.length, 2);
});
