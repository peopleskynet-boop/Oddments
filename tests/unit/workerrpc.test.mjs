// Calls into a worker (src/lib/workerrpc.js): answers, errors, and a dead worker never leaves a call hanging
import test from 'node:test';
import assert from 'node:assert/strict';
import { workerRpc } from '../../src/lib/workerrpc.js';

class FakeWorker {
  constructor() { this.sent = []; this.terminated = false; }
  postMessage(m) { this.sent.push(m); }
  answer(m) { this.onmessage({ data: m }); }
  terminate() { this.terminated = true; }
}

test('each call gets the answer with its own rid', async () => {
  const fw = new FakeWorker();
  const w = workerRpc(() => fw);
  const a = w.call({ type: 'x' }), b = w.call({ type: 'y' });
  fw.answer({ rid: fw.sent[1].rid, v: 'b' });
  fw.answer({ rid: fw.sent[0].rid, v: 'a' });
  assert.equal((await a).v, 'a');
  assert.equal((await b).v, 'b');
});

test('an error answer rejects only that call', async () => {
  const fw = new FakeWorker();
  const w = workerRpc(() => fw);
  const a = w.call({});
  fw.answer({ rid: fw.sent[0].rid, type: 'error', error: 'no model' });
  await assert.rejects(a, /no model/);
  assert.ok(w.alive);
});

test('a crash rejects every waiting call, tells the owner, and refuses new calls', async () => {
  const fw = new FakeWorker();
  let told = '';
  const w = workerRpc(() => fw, (m) => { told = m; });
  const a = w.call({}), b = w.call({});
  fw.onerror({ message: 'out of memory' });
  await assert.rejects(a, /out of memory/);
  await assert.rejects(b, /out of memory/);
  await assert.rejects(w.call({}), /out of memory/);
  assert.equal(told, 'out of memory');
});

test('terminate stops the worker and fails what waits, without calling onCrash', async () => {
  const fw = new FakeWorker();
  let told = false;
  const w = workerRpc(() => fw, () => { told = true; });
  const a = w.call({});
  w.terminate('ИИ выключен');
  await assert.rejects(a, /ИИ выключен/);
  assert.ok(fw.terminated);
  assert.equal(told, false);
});
