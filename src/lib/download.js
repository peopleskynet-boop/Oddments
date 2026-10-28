// Big downloads into the app's own folder (AI models, the text-reading model, lighting HDRIs), in one place:
// - streamed and written in 8 MB pieces (the body comes over IPC in small chunks; one write per chunk is slow);
// - resumed: the bytes so far stay in <path>.part and the next try asks for the rest (HTTP Range);
// - checked: the file is renamed into place only when it has exactly `size` bytes, so a cut-off download never
//   looks like a finished one.
// onBytes(n) is called with every n bytes that arrive (also with the bytes already there when resuming), so the
// caller keeps its own progress; stop() returning true cancels between pieces. Throws on any failure.
import * as fs from '@tauri-apps/plugin-fs';

export async function downloadFile(url, path, { size, signal, onBytes, stop, what = 'файл' } = {}) {
  const { fetch: tfetch } = await import('@tauri-apps/plugin-http');
  const part = path + '.part';
  const have = size ? await fs.stat(part).then((st) => (st.size < size ? st.size : 0)).catch(() => 0) : 0;
  const r = await tfetch(url, { method: 'GET', headers: have ? { Range: `bytes=${have}-` } : {}, signal });
  if (!r.ok) throw new Error(`${new URL(url).hostname} ответил ${r.status}`);
  const resume = have > 0 && r.status === 206; // the server sent only the rest
  const file = await fs.open(part, resume ? { write: true, append: true } : { write: true, create: true, truncate: true });
  let got = resume ? have : 0;
  if (resume && onBytes) onBytes(have);
  try {
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      let pend = [], pendLen = 0;
      const flush = async () => {
        if (!pendLen) return;
        const buf = new Uint8Array(pendLen);
        let o = 0;
        for (const c of pend) { buf.set(c, o); o += c.length; }
        pend = []; pendLen = 0;
        await file.write(buf);
      };
      for (;;) {
        if (stop && stop()) { await rd.cancel().catch(() => {}); throw new Error('загрузка остановлена'); }
        const { done, value } = await rd.read();
        if (done) break;
        pend.push(value); pendLen += value.length; got += value.length;
        if (onBytes) onBytes(value.length);
        if (pendLen >= 8 << 20) await flush();
      }
      await flush();
    } else {
      const buf = new Uint8Array(await r.arrayBuffer());
      await file.write(buf);
      got += buf.length;
      if (onBytes) onBytes(buf.length);
    }
  } finally { await file.close(); }
  if (size && got !== size) throw new Error(`${what} скачался не полностью — следующая попытка докачает остальное`);
  await fs.rename(part, path);
  return got;
}
