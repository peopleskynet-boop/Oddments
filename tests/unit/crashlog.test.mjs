// The crash report (src/lib/crashlog.js): a panic keeps its message however long its backtrace is
import test from 'node:test';
import assert from 'node:assert/strict';
import { panicsForReport } from '../../src/lib/crashlog.js';

const frames = (from, to, name = '<unknown>') => Array.from({ length: to - from + 1 }, (_, i) => `${String(from + i).padStart(4)}: ${name}`);
const panic = (n, ...lines) => [`--- panic · Oddments 1.0.2 · unix ${n} · thread main`, `panicked at a.rs:${n}:1:`, 'assertion failed', ...lines].join('\n');

test('a long backtrace keeps the message, frames without a name shrink to one line', () => {
  const log = panic(1, ...frames(0, 9), ...frames(10, 11, 'CallWindowProcW'), ...frames(12, 80), ...frames(81, 81, 'RtlUserThreadStart'), ...frames(82, 82)) + '\n\n';
  assert.deepEqual(panicsForReport(log).split('\n'), [
    '--- panic · Oddments 1.0.2 · unix 1 · thread main',
    'panicked at a.rs:1:1:',
    'assertion failed',
    ' 0-9: <unknown>',
    '  10: CallWindowProcW',
    '  11: CallWindowProcW',
    '12-80: <unknown>',
    '  81: RtlUserThreadStart',
    '  82: <unknown>',
  ]);
});

test('frames with a place in the code stay as they are', () => {
  const lines = ['   0: tao::run', '             at src/lib.rs:1', '   1: <unknown>'];
  assert.deepEqual(panicsForReport(panic(1, ...lines)).split('\n').slice(3), lines);
});

test('the last panics, whole; a backtrace too long loses its end', () => {
  const log = [1, 2, 3, 4].map((n) => panic(n, ...frames(0, 1, 'f'))).join('\n\n');
  const out = panicsForReport(log, 2);
  assert.ok(!out.includes('unix 2') && out.includes('unix 3') && out.includes('unix 4'));
  assert.equal(out.split('\n\n').length, 2);
  const long = panicsForReport(panic(5, ...frames(0, 199, 'f')), 3, 10).split('\n');
  assert.equal(long.length, 11);
  assert.equal(long[1], 'panicked at a.rs:5:1:');
  assert.equal(long[10], '  ... 193 more lines');
});

test('an empty log gives an empty report', () => {
  assert.equal(panicsForReport(''), '');
  assert.equal(panicsForReport('\n\n'), '');
});
