// The grid's layout maths (src/ui/layout.js): no overlaps, nothing past the width, the visible range
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, visibleRange } from '../../src/ui/layout.js';

const items = Array.from({ length: 300 }, (_, i) => ({ ar: [0.5, 0.75, 1, 1.4, 3, 9, 0][i % 7] }));
const overlap = (a, b) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

for (const mode of ['masonry', 'grid']) {
  test(`${mode}: cards stay inside the width and never overlap`, () => {
    const { boxes, height, cols } = computeLayout(items, 1180, 220, 14, 0, mode);
    assert.equal(cols, 5);
    for (const b of boxes) assert.ok(b.x >= 0 && b.x + b.w <= 1180 + 0.01 && b.y + b.h <= height + 0.01);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${i} × ${j}`);
  });
}

test('a window narrower than one card still lays out one column', () => {
  const { cols, boxes } = computeLayout(items.slice(0, 3), 100, 220, 14, 0, 'masonry');
  assert.equal(cols, 1);
  assert.equal(boxes[0].w, 100);
});

test('an empty library has zero height', () => {
  assert.equal(computeLayout([], 1000, 200, 10, 0, 'grid').height, 0);
  assert.equal(computeLayout([], 1000, 200, 10, 0, 'masonry').height, 0);
});

test('visibleRange returns exactly the boxes crossing the window', () => {
  const { boxes } = computeLayout(items, 1000, 200, 10, 20, 'masonry');
  const vis = visibleRange(boxes, 500, 1300);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i], inside = b.y + b.h >= 500 && b.y <= 1300;
    assert.equal(vis.includes(i), inside, `box ${i}`);
  }
});
