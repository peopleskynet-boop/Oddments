// Calls into a background worker as promises. The worker answers each message with the same `rid`, and
// `{ type: 'error', error }` for a failure. If the worker dies (it threw outside a message, ran out of memory, its
// script did not load), every call still waiting is rejected — a caller never hangs on a worker that is gone.
//
//   const w = workerRpc(() => new Worker(new URL('./x.worker.js', import.meta.url), { type: 'module' }), onCrash);
//   const r = await w.call({ type: 'read', url }, [transferables]);
// (the Worker is made by the caller: Vite bundles a worker only from `new Worker(new URL(…))` in place)
export function workerRpc(make, onCrash) {
  const worker = make();
  const waiting = new Map();
  let rid = 0, dead = null;
  const end = (msg) => {
    if (dead) return;
    dead = new Error(msg);
    waiting.forEach((w) => w.rej(dead));
    waiting.clear();
  };
  worker.onmessage = ({ data: m }) => {
    const w = waiting.get(m && m.rid);
    if (!w) return;
    waiting.delete(m.rid);
    if (m.type === 'error') w.rej(new Error(m.error)); else w.res(m);
  };
  const crash = (msg) => { if (dead) return; end(msg); if (onCrash) onCrash(msg); };
  worker.onerror = (e) => crash((e && e.message) || 'без подробностей');
  worker.onmessageerror = () => crash('ответ потока не прочитался');
  return {
    call(msg, transfer) {
      if (dead) return Promise.reject(dead);
      return new Promise((res, rej) => {
        const id = ++rid;
        waiting.set(id, { res, rej });
        worker.postMessage({ ...msg, rid: id }, transfer || []);
      });
    },
    // stopped on purpose: what waits fails with this reason, onCrash is not called
    terminate(reason = 'остановлено') { worker.terminate(); end(reason); },
    get alive() { return !dead; },
  };
}
