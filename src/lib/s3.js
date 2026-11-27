// S3 for «Поделиться ссылкой» (lib/share.js): the few calls a shared link needs, signed with AWS Signature V4 — Yandex
// Object Storage or any S3-compatible storage. Path-style addresses (https://storage.yandexcloud.net/<bucket>/<key>). The
// fetch is passed in: in the app it is plugin-http's (no CORS, behind «Без сети»), in the unit tests Node's own. Nothing
// here keeps the keys; they come with each client and never go into an error message.
const enc = new TextEncoder();
const bytes = (d) => (typeof d === 'string' ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const sha256Hex = async (data) => hex(await crypto.subtle.digest('SHA-256', bytes(data)));
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', bytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, bytes(msg)));
}

// RFC 3986 as S3 wants it: everything but A–Z a–z 0–9 - _ . ~ encoded; «/» kept in a path, encoded in a query
export function uriEncode(s, keepSlash = false) {
  const e = encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return keepSlash ? e.replace(/%2F/g, '/') : e;
}

// The headers that sign a request: the given ones plus x-amz-date, x-amz-content-sha256 and Authorization. host is signed
// but not returned (fetch sets it). query: [[name, value]] — a bare «?website» is ['website', ''].
export async function sign({ method, host, path, query = [], headers = {}, payloadHash = EMPTY_SHA, accessKey, secretKey, region, service = 's3', now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const h = {};
  for (const [k, v] of Object.entries(headers)) if (v != null) h[k.toLowerCase()] = String(v);
  h['x-amz-date'] = amzDate;
  h['x-amz-content-sha256'] = payloadHash;
  const all = { ...h, host };
  const names = Object.keys(all).sort();
  const canonQuery = query.map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canon = [method, path, canonQuery, names.map((n) => `${n}:${all[n].trim().replace(/\s+/g, ' ')}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canon)].join('\n');
  let key = await hmac('AWS4' + secretKey, day);
  for (const part of [region, service, 'aws4_request']) key = await hmac(key, part);
  h.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hex(await hmac(key, toSign))}`;
  return h;
}

/* ---------- MD5 (Content-MD5 of DeleteObjects and the lifecycle; crypto.subtle has none) ---------- */
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5(data) {
  const msg = bytes(data), n = msg.length;
  const len = (((n + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(len - 8, (n * 8) >>> 0, true);
  dv.setUint32(len - 4, Math.floor(n / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < len; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16), ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true));
  return out;
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
export const md5Base64 = (data) => b64(md5(data));

/* ---------- the client ---------- */
const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const tag = (xml, t) => [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map((m) => m[1]);
const unXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export class S3Error extends Error {
  constructor(status, code, message) { super(`${code || 'HTTP ' + status}${message ? ': ' + message : ''}`); this.status = status; this.code = code; }
}

// cfg: { endpoint, region, bucket, accessKey, secretKey, fetch }
export function s3Client(cfg) {
  const base = String(cfg.endpoint || '').replace(/\/+$/, '');
  const host = new URL(base).host;
  const keyPath = (key) => '/' + uriEncode(cfg.bucket) + (key == null ? '' : '/' + uriEncode(key, true));

  async function call(method, key, { query = [], headers = {}, body = null, ok = [200, 204] } = {}) {
    const path = keyPath(key);
    const payload = body == null ? null : bytes(body);
    const signed = await sign({ method, host, path, query, headers, payloadHash: payload ? await sha256Hex(payload) : EMPTY_SHA,
      accessKey: cfg.accessKey, secretKey: cfg.secretKey, region: cfg.region });
    const qs = query.map(([k, v]) => uriEncode(k) + (v === '' ? '' : '=' + uriEncode(v))).join('&');
    const res = await cfg.fetch(base + path + (qs ? '?' + qs : ''), { method, headers: signed, body: payload || undefined });
    if (!ok.includes(res.status)) {
      const text = await res.text().catch(() => '');
      throw new S3Error(res.status, unXml(tag(text, 'Code')[0] || ''), unXml(tag(text, 'Message')[0] || ''));
    }
    return res;
  }
  // what goes with an object: its type, how long a browser keeps it, who reads it, the term tag (lib/share.js)
  const objHeaders = (o = {}) => ({
    'content-type': o.type || 'application/octet-stream',
    'cache-control': o.cache || undefined,
    'x-amz-acl': o.acl || undefined,
    'x-amz-tagging': o.tags ? Object.entries(o.tags).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&') : undefined,
  });

  return {
    bucket: cfg.bucket,
    put: (key, body, o) => call('PUT', key, { body, headers: objHeaders(o) }),
    async head(key) { const r = await call('HEAD', key, { ok: [200, 404] }); return r.status === 200 ? r : null; },
    // the object again under its own name: it counts as new (the term starts over) with new headers and tags
    copySelf: (key, o) => call('PUT', key, { headers: { ...objHeaders(o), 'x-amz-copy-source': keyPath(key),
      'x-amz-metadata-directive': 'REPLACE', 'x-amz-tagging-directive': 'REPLACE' } }),
    del: (key) => call('DELETE', key, { ok: [200, 204, 404] }),
    async list(prefix) {
      const out = [];
      let token = '';
      do {
        const query = [['list-type', '2'], ['prefix', prefix]];
        if (token) query.push(['continuation-token', token]);
        const xml = await (await call('GET', null, { query })).text();
        for (const c of tag(xml, 'Contents')) out.push({ key: unXml(tag(c, 'Key')[0] || ''), size: +(tag(c, 'Size')[0] || 0) });
        token = tag(xml, 'IsTruncated')[0] === 'true' ? unXml(tag(xml, 'NextContinuationToken')[0] || '') : '';
      } while (token);
      return out;
    },
    async delMany(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${keys.slice(i, i + 1000).map((k) => `<Object><Key>${xmlEsc(k)}</Key></Object>`).join('')}</Delete>`;
        const xml = await (await call('POST', null, { query: [['delete', '']], body, headers: { 'content-type': 'application/xml', 'content-md5': md5Base64(body) } })).text();
        const err = tag(xml, 'Error')[0];
        if (err) throw new S3Error(200, unXml(tag(err, 'Code')[0] || ''), unXml(tag(err, 'Key')[0] || ''));
      }
    },
    // a big file in parts (lib/share.js reads it piece by piece): start, parts, finish — or abort on the way
    async startParts(key, o) { return unXml(tag(await (await call('POST', key, { query: [['uploads', '']], headers: objHeaders(o) })).text(), 'UploadId')[0] || ''); },
    async putPart(key, uploadId, n, body) { return (await call('PUT', key, { query: [['partNumber', String(n)], ['uploadId', uploadId]], body })).headers.get('etag'); },
    async endParts(key, uploadId, etags) {
      const body = `<CompleteMultipartUpload>${etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${xmlEsc(e)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
      const xml = await (await call('POST', key, { query: [['uploadId', uploadId]], body, headers: { 'content-type': 'application/xml' } })).text();
      if (tag(xml, 'Error')[0]) throw new S3Error(200, unXml(tag(xml, 'Code')[0] || ''), unXml(tag(xml, 'Message')[0] || ''));
    },
    abortParts: (key, uploadId) => call('DELETE', key, { query: [['uploadId', uploadId]], ok: [200, 204, 404] }),
    /* the bucket once («Подготовить хранилище»): it, the site, the terms */
    async createBucket() {
      try { await call('PUT', null); } catch (e) { if (e.code !== 'BucketAlreadyOwnedByYou') throw e; }
    },
    putWebsite: (index, error) => call('PUT', null, { query: [['website', '']], headers: { 'content-type': 'application/xml' },
      body: `<WebsiteConfiguration><IndexDocument><Suffix>${xmlEsc(index)}</Suffix></IndexDocument><ErrorDocument><Key>${xmlEsc(error)}</Key></ErrorDocument></WebsiteConfiguration>` }),
    // rules: [{ id, tag: [key, value], days }] — an object carrying the tag is removed that many days after it was written
    putLifecycle(rules) {
      const body = `<LifecycleConfiguration>${rules.map((r) => `<Rule><ID>${xmlEsc(r.id)}</ID><Status>Enabled</Status><Filter><Tag><Key>${xmlEsc(r.tag[0])}</Key><Value>${xmlEsc(r.tag[1])}</Value></Tag></Filter><Expiration><Days>${r.days}</Days></Expiration></Rule>`).join('')}</LifecycleConfiguration>`;
      return call('PUT', null, { query: [['lifecycle', '']], body, headers: { 'content-type': 'application/xml', 'content-md5': md5Base64(body) } });
    },
  };
}
