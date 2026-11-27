// A stand-in for S3 storage to try «Поделиться ссылкой» end to end without a cloud (CLAUDE.md, 17.11.2026):
//   node tests/share/fakes3.mjs [apiPort=47301] [sitePort=47302]
// API (path-style /<bucket>/<key>, the calls src/lib/s3.js makes): every request's AWS signature is checked against the
// raw address it came with (key «K», secret «S», region ru-central1) — a mismatch answers SignatureDoesNotMatch, as the
// real storage would. CORS is open so `npm run web` can call it. The site port serves the bucket like a static website:
// «…/» → «…/index.html», public-read objects only, Range for video, 404.html for what is not there.
import http from 'node:http';
import { sign } from '../../src/lib/s3.js';

const API = +(process.argv[2] || 47301), SITE = +(process.argv[3] || 47302);
const KEY = 'K', SECRET = 'S', REGION = 'ru-central1';
const store = new Map(); // key -> { body, type, acl, tags, cache, at }
const parts = new Map(); // uploadId -> Map(n -> Buffer)
let bucket = null, website = null, lifecycle = null;

const xml = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/xml' }); res.end(body); };
const err = (res, status, code, msg = '') => xml(res, status, `<Error><Code>${code}</Code><Message>${msg}</Message></Error>`);
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
const tagsOf = (h) => Object.fromEntries(new URLSearchParams(h || ''));
let etagN = 0;

async function checkSig(req, path, query) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/SignedHeaders=([^,]+), Signature=([0-9a-f]+)/);
  if (!m) return false;
  const names = m[1].split(';').filter((n) => !['host', 'x-amz-date', 'x-amz-content-sha256'].includes(n));
  const headers = Object.fromEntries(names.map((n) => [n, req.headers[n]]));
  const d = req.headers['x-amz-date'];
  const now = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
  const h = await sign({ method: req.method, host: req.headers.host, path, query, headers, payloadHash: req.headers['x-amz-content-sha256'], accessKey: KEY, secretKey: SECRET, region: REGION, now });
  return h.authorization === auth;
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const [rawPath, rawQuery = ''] = req.url.split('?');
  const query = rawQuery ? rawQuery.split('&').map((p) => { const [k, v = ''] = p.split('='); return [decodeURIComponent(k), decodeURIComponent(v)]; }) : [];
  const q = Object.fromEntries(query);
  const body = await readBody(req);
  if (!(await checkSig(req, rawPath, query))) return err(res, 403, 'SignatureDoesNotMatch', 'signature mismatch');
  const segs = rawPath.split('/').slice(1);
  const b = decodeURIComponent(segs.shift() || ''), key = segs.map(decodeURIComponent).join('/');
  if (bucket && b !== bucket) return err(res, 404, 'NoSuchBucket');
  if (!key) {
    if (req.method === 'PUT' && 'website' in q) { website = body.toString(); res.writeHead(200); res.end(); return; }
    if (req.method === 'PUT' && 'lifecycle' in q) { if (!req.headers['content-md5']) return err(res, 400, 'InvalidRequest', 'Content-MD5 required'); lifecycle = body.toString(); res.writeHead(200); res.end(); return; }
    if (req.method === 'PUT') { if (bucket === b) return err(res, 409, 'BucketAlreadyOwnedByYou'); bucket = b; res.writeHead(200); res.end(); return; }
    if (!bucket) return err(res, 404, 'NoSuchBucket');
    if (req.method === 'GET' && q['list-type'] === '2') {
      const keys = [...store.keys()].filter((k) => k.startsWith(q.prefix || '')).sort();
      const start = q['continuation-token'] ? +q['continuation-token'] : 0, page = keys.slice(start, start + 50);
      const more = start + 50 < keys.length;
      return xml(res, 200, `<ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Key><Size>${store.get(k).body.length}</Size></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 50}</NextContinuationToken>` : ''}</ListBucketResult>`);
    }
    if (req.method === 'POST' && 'delete' in q) {
      for (const m of body.toString().matchAll(/<Key>([\s\S]*?)<\/Key>/g)) store.delete(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
      return xml(res, 200, '<DeleteResult></DeleteResult>');
    }
    return err(res, 400, 'NotImplemented');
  }
  if (!bucket) return err(res, 404, 'NoSuchBucket');
  const meta = { type: req.headers['content-type'] || 'application/octet-stream', acl: req.headers['x-amz-acl'] || 'private', tags: tagsOf(req.headers['x-amz-tagging']), cache: req.headers['cache-control'] || '', at: Date.now() };
  if (req.method === 'POST' && 'uploads' in q) { const id = 'U' + Date.now() + Math.random().toString(36).slice(2); parts.set(id, { map: new Map(), meta }); return xml(res, 200, `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`); }
  if (req.method === 'PUT' && q.uploadId) { const u = parts.get(q.uploadId); if (!u) return err(res, 404, 'NoSuchUpload'); u.map.set(+q.partNumber, body); res.writeHead(200, { ETag: `"p${++etagN}"` }); res.end(); return; }
  if (req.method === 'POST' && q.uploadId) { const u = parts.get(q.uploadId); if (!u) return err(res, 404, 'NoSuchUpload'); const n = [...u.map.keys()].sort((a, c) => a - c); store.set(key, { ...u.meta, body: Buffer.concat(n.map((i) => u.map.get(i))) }); parts.delete(q.uploadId); return xml(res, 200, '<CompleteMultipartUploadResult></CompleteMultipartUploadResult>'); }
  if (req.method === 'DELETE' && q.uploadId) { parts.delete(q.uploadId); res.writeHead(204); res.end(); return; }
  if (req.method === 'PUT' && req.headers['x-amz-copy-source']) {
    const src = decodeURIComponent(req.headers['x-amz-copy-source'].replace(/^\/[^/]+\//, ''));
    const o = store.get(src);
    if (!o) return err(res, 404, 'NoSuchKey');
    if (src === key && req.headers['x-amz-metadata-directive'] !== 'REPLACE') return err(res, 400, 'InvalidRequest', 'copy to itself without changing metadata');
    store.set(key, { ...meta, body: o.body });
    return xml(res, 200, '<CopyObjectResult></CopyObjectResult>');
  }
  if (req.method === 'PUT') { store.set(key, { ...meta, body }); res.writeHead(200, { ETag: `"o${++etagN}"` }); res.end(); return; }
  if (req.method === 'DELETE') { store.delete(key); res.writeHead(204); res.end(); return; }
  const o = store.get(key);
  if (!o) { if (req.method === 'HEAD') { res.writeHead(404); res.end(); return; } return err(res, 404, 'NoSuchKey'); }
  res.writeHead(200, { 'Content-Type': o.type, 'Content-Length': o.body.length, 'x-odd-tags': JSON.stringify(o.tags) });
  res.end(req.method === 'HEAD' ? undefined : o.body);
}).listen(API, '127.0.0.1');

// the bucket as a website (what a link's visitor sees)
http.createServer((req, res) => {
  let key = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
  if (key === '' || key.endsWith('/')) key += 'index.html';
  const o = store.get(key);
  if (!o || o.acl !== 'public-read') {
    const nf = store.get('404.html');
    res.writeHead(404, { 'Content-Type': nf ? nf.type : 'text/plain' });
    res.end(nf ? nf.body : 'Not found');
    return;
  }
  const range = req.headers.range && req.headers.range.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const s = +range[1], e = range[2] ? Math.min(+range[2], o.body.length - 1) : o.body.length - 1;
    res.writeHead(206, { 'Content-Type': o.type, 'Content-Range': `bytes ${s}-${e}/${o.body.length}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' });
    res.end(o.body.subarray(s, e + 1));
    return;
  }
  res.writeHead(200, { 'Content-Type': o.type, 'Content-Length': o.body.length, 'Accept-Ranges': 'bytes', ...(o.cache ? { 'Cache-Control': o.cache } : {}) });
  res.end(req.method === 'HEAD' ? undefined : o.body);
}).listen(SITE, '127.0.0.1');

// what the storage holds, for the checks: GET /__state on the API port
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ bucket, website, lifecycle, objects: [...store].map(([k, o]) => ({ key: k, size: o.body.length, type: o.type, acl: o.acl, tags: o.tags, cache: o.cache })) }));
}).listen(API + 2, '127.0.0.1');
console.log(`fake S3: api http://127.0.0.1:${API}  site http://127.0.0.1:${SITE}  state http://127.0.0.1:${API + 2}`);
