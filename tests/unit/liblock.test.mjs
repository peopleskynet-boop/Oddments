// «Занято» (src/lib/liblock.js): who may write in a library folder — the decision alone, without a disk
import test from 'node:test';
import assert from 'node:assert/strict';
import { lockState, holderText, STALE_MS } from '../../src/lib/liblock.js';

const now = 1_800_000_000_000;

test('no mark, a broken one or one without an id: free', () => {
  assert.equal(lockState(null, 'me', now), 'free');
  assert.equal(lockState('x', 'me', now), 'free');
  assert.equal(lockState({ at: now }, 'me', now), 'free');
});

test('this window\'s own mark (a reload of the same tab): mine', () => {
  assert.equal(lockState({ id: 'me', at: now - 10 * 60e3 }, 'me', now), 'mine');
});

test('another one\'s fresh mark: busy; refreshed too long ago: free', () => {
  assert.equal(lockState({ id: 'other', at: now - 1000 }, 'me', now), 'busy');
  assert.equal(lockState({ id: 'other', at: now - STALE_MS + 1000 }, 'me', now), 'busy');
  assert.equal(lockState({ id: 'other', at: now - STALE_MS - 1 }, 'me', now), 'free');
});

test('a clock ahead on the other computer counts the same way, both directions', () => {
  assert.equal(lockState({ id: 'other', at: now + 60e3 }, 'me', now), 'busy');
  assert.equal(lockState({ id: 'other', at: now + STALE_MS + 1 }, 'me', now), 'free');
});

test('who holds it, in the strip\'s words', () => {
  assert.match(holderText({ app: 'desktop' }), /настольном/);
  assert.match(holderText({ app: 'web', name: 'Oddments Web · Firefox' }), /Firefox/);
});
