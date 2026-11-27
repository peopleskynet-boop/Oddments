// The service worker of Oddments Web. vite.config.js (litePwa) writes the version and the list of the build's files in;
// in `npm run lite` the list is empty and only the library's files are served.
// - Offline: the page, the code, the styles and the fonts are kept on install and served from there (cache first). A
//   new build installs next to the running one and waits until the page asks it to take over (the «Обновить» toast,
//   ui/liteui.js) — a running page never loses the chunks it still loads lazily.
// - The library's files by address: <img>, <video> and CSS need a URL at once (lite-core.js convertFileSrc), so
//   …/__odd/fs/lib/files/<id>/thumb.webp is answered with the file the page itself reads from OPFS or the folder on
//   disk (lite-fs.js serveFiles: the page holds the folder's permission). Range requests get 206 (video seeks).
const VERSION = '__ODD_VERSION__';
const PRECACHE = /*__ODD_PRECACHE__*/[];
const CACHE = 'oddments-web-' + VERSION;
const SCOPE = new URL(self.registration.scope);
const FS = SCOPE.pathname + '__odd/fs/';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    if (PRECACHE.length) {
      const c = await caches.open(CACHE);
      await c.addAll(PRECACHE.map((f) => new URL(f, SCOPE).href));
    }
    // the first install takes over at once (there is nothing to keep); a newer build waits for the page
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('oddments-web-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'odd-update') self.skipWaiting();
  if (e.data && e.data.type === 'odd-version' && e.ports[0]) e.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== SCOPE.origin) return; // other sites: as the browser does it
  if (u.pathname.startsWith(FS)) { e.respondWith(libFile(e.request, e.clientId, decodeURIComponent(u.pathname.slice(FS.length - 1)))); return; }
  if (e.request.method !== 'GET' || !PRECACHE.length) return;
  e.respondWith(fromCache(e.request));
});

async function fromCache(req) {
  const c = await caches.open(CACHE);
  const nav = req.mode === 'navigate';
  // ignoreVary: a server's «Vary: Origin» would miss the module scripts (they come with an Origin header, the copies
  // were kept without one) — the build's files do not change under one name
  const hit = await c.match(nav ? new URL('./', SCOPE).href : req, { ignoreSearch: nav, ignoreVary: true });
  if (hit) return hit;
  try { return await fetch(req); } catch (err) {
    if (nav) { const page = await c.match(new URL('index.html', SCOPE).href, { ignoreVary: true }); if (page) return page; }
    throw err;
  }
}

// the library's file, from the page that asked (or any open page of the app: they share the library)
async function libFile(req, clientId, path) {
  const all = await self.clients.matchAll({ type: 'window' });
  const order = [all.find((c) => c.id === clientId), ...all.filter((c) => c.id !== clientId)].filter(Boolean);
  let got = null;
  for (const c of order) { got = await ask(c, path); if (got && got.blob) break; }
  if (!got || !got.blob) return new Response('', { status: 404, statusText: 'Not Found' });
  const blob = got.blob, type = got.type || blob.type || 'application/octet-stream', size = blob.size;
  const range = req.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] || m[2])) {
    let start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
    let end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(blob.slice(start, end + 1), { status: 206, headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' } });
  }
  return new Response(blob, { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
}

function ask(client, path) {
  return new Promise((res) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => res(null), 20000);
    ch.port1.onmessage = (m) => { clearTimeout(t); res(m.data); };
    client.postMessage({ type: 'odd-fs', path }, [ch.port2]);
  });
}
