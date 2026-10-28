// Usability studies (src/lib/study.js): several respondents of one scenario summed up per step
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, reportMd, studyHints } from '../../src/lib/study.js';

const flow = (resp, n, sig = {}, notes = []) => ({ resp, steps: Array.from({ length: n }, (_, i) => ({ id: `${resp}${i}`, flowT: i * 4, flowSig: sig[i] })), notes });

test('«3 из 5 вернулись назад на шаге 4» — and it comes first', () => {
  const back = { 3: [{ k: 'back', to: 2 }] };
  const flows = [flow('a', 6, back), flow('b', 6, back), flow('c', 6, back), flow('d', 6), flow('e', 6, { 1: [{ k: 'wait', s: 3 }] })];
  const agg = aggregate(flows);
  assert.equal(agg.n, 5);
  assert.equal(agg.sentences[0].text, '3 из 5 вернулись назад на шаге 4');
  assert.ok(agg.sentences.some((s) => s.text === '1 из 5 ждали загрузку перед шагом 2'));
});

test('fewer steps: not everyone got to the end', () => {
  const agg = aggregate([flow('a', 5), flow('b', 3)]);
  assert.equal(agg.steps[4].reached, 1);
  assert.ok(agg.sentences.some((s) => s.text === '1 из 2 дошли до последнего шага'));
});

test('notes land on their step; the report has quotes in quotation marks', () => {
  const flows = [flow('Анна', 3, {}, [{ step: 'Анна1', kind: 'quote', text: 'Где тут перевод?', t: 4 }, { step: 'Анна2', kind: 'problem', text: 'Не нашла кнопку' }])];
  const agg = aggregate(flows);
  assert.equal(agg.steps[1].notes.length, 1);
  const md = reportMd('Перевод по номеру', flows, agg);
  assert.match(md, /Шаг 2, 0:04 — Анна: «Где тут перевод\?»/);
  assert.match(md, /\| 3 \| 1 \| 0 \| 0 \| 0 \| 1 \|/);
  assert.deepEqual(studyHints(agg)[2].map((h) => h.text), ['Анна: Не нашла кнопку']);
});
