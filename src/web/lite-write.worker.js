// Oddments Web, Safari: its main thread has no createWritable for OPFS files — this worker writes a file whole with a
// sync access handle (lite-fs.js viaWorker). path: the segments from the OPFS root.
self.onmessage = async (m) => {
  const { id, path, data } = m.data;
  try {
    let d = await navigator.storage.getDirectory();
    for (const s of path.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true });
    const fh = await d.getFileHandle(path[path.length - 1], { create: true });
    const h = await fh.createSyncAccessHandle();
    try { h.truncate(0); h.write(new Uint8Array(data), { at: 0 }); h.flush(); } finally { h.close(); }
    self.postMessage({ id });
  } catch (e) { self.postMessage({ id, error: String((e && e.message) || e) }); }
};
