// S3 for «Поделиться ссылкой» (src/lib/s3.js): Signature V4 against the examples of the AWS documentation, MD5 against
// Node's, the requests a client makes
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sign, md5, md5Base64, sha256Hex, uriEncode, s3Client, EMPTY_SHA } from '../../src/lib/s3.js';

const AWS = { accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', host: 'examplebucket.s3.amazonaws.com', now: new Date('2013-05-24T00:00:00Z') };
const sig = (h) => h.authorization.match(/Signature=([0-9a-f]+)/)[1];

test('Signature V4: the GET Object example of the AWS documentation', async () => {
  const h = await sign({ ...AWS, method: 'GET', path: '/test.txt', headers: { Range: 'bytes=0-9' } });
  assert.match(h.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
  assert.equal(sig(h), 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(h['x-amz-date'], '20130524T000000Z');
  assert.equal(h.host, undefined); // fetch sets it
});

test('Signature V4: the PUT Object example (a «$» in the key, a body)', async () => {
  const body = 'Welcome to Amazon S3.';
  const payloadHash = await sha256Hex(body);
  assert.equal(payloadHash, '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  const h = await sign({ ...AWS, method: 'PUT', path: '/' + uriEncode('test$file.text', true), payloadHash,
    headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' } });
  assert.equal(sig(h), '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('Signature V4: the query examples (?lifecycle, ?max-keys=2&prefix=J)', async () => {
  assert.equal(sig(await sign({ ...AWS, method: 'GET', path: '/', query: [['lifecycle', '']] })), 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  assert.equal(sig(await sign({ ...AWS, method: 'GET', path: '/', query: [['prefix', 'J'], ['max-keys', '2']] })), '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('MD5 matches Node, across the block edges', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100000]) {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
    assert.equal(Buffer.from(md5(data)).toString('hex'), createHash('md5').update(data).digest('hex'), `length ${n}`);
  }
  assert.equal(md5Base64('abc'), createHash('md5').update('abc').digest('base64'));
});

test('uriEncode: S3 encoding, «/» only kept in a path', () => {
  assert.equal(uriEncode("a b+c!*'()~._-"), 'a%20b%2Bc%21%2A%27%28%29~._-');
  assert.equal(uriEncode('s/ab/Постер.png', true), 's/ab/%D0%9F%D0%BE%D1%81%D1%82%D0%B5%D1%80.png');
  assert.equal(uriEncode('s/ab'), 's%2Fab');
});

// a fetch that records what the client sends and answers from a script
function recorder(answers = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, search: u.search, headers: init.headers, body: init.body ? Buffer.from(init.body).toString() : '' });
    const a = answers[`${init.method} ${u.pathname}${u.search}`] || { status: 200, body: '' };
    return new Response(a.body || null, { status: a.status, headers: a.headers || {} });
  };
  return { calls, fetch };
}
const client = (fetch) => s3Client({ endpoint: 'https://storage.example.net/', region: 'ru-central1', bucket: 'odd-b', accessKey: 'K', secretKey: 'S', fetch });

test('client: an object goes up with its type, reading rights and the term tag, signed', async () => {
  const r = recorder();
  await client(r.fetch).put('s/x1/lib/files/a/Постер.png', new Uint8Array([1, 2, 3]), { type: 'image/png', acl: 'public-read', tags: { 'odd-ttl': '30' }, cache: 'max-age=60' });
  const c = r.calls[0];
  assert.equal(c.method, 'PUT');
  assert.equal(c.path, '/odd-b/s/x1/lib/files/a/%D0%9F%D0%BE%D1%81%D1%82%D0%B5%D1%80.png');
  assert.equal(c.headers['content-type'], 'image/png');
  assert.equal(c.headers['x-amz-acl'], 'public-read');
  assert.equal(c.headers['x-amz-tagging'], 'odd-ttl=30');
  assert.equal(c.headers['x-amz-content-sha256'], await sha256Hex(new Uint8Array([1, 2, 3])));
  assert.equal(c.headers['cache-control'], 'max-age=60');
  assert.match(c.headers.authorization, /^AWS4-HMAC-SHA256 Credential=K\/\d{8}\/ru-central1\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-acl;x-amz-content-sha256;x-amz-date;x-amz-tagging, Signature=[0-9a-f]{64}$/);
  // what was not given is not sent
  await client(r.fetch).put('k', 'x');
  assert.deepEqual(Object.keys(r.calls[1].headers).sort(), ['authorization', 'content-type', 'x-amz-content-sha256', 'x-amz-date']);
});

test('client: list pages through, delete in batches with Content-MD5', async () => {
  const page = (keys, next) => `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><Size>5</Size></Contents>`).join('')}<IsTruncated>${next ? 'true' : 'false'}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ''}</ListBucketResult>`;
  const r = recorder({
    'GET /odd-b?list-type=2&prefix=s%2Fx1%2F': { status: 200, body: page(['s/x1/a', 's/x1/b&c'], 'T1') },
    'GET /odd-b?list-type=2&prefix=s%2Fx1%2F&continuation-token=T1': { status: 200, body: page(['s/x1/c'], '') },
    'HEAD /odd-b/missing': { status: 404 },
    'DELETE /odd-b/missing': { status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' },
  });
  const s3 = client(r.fetch);
  const keys = (await s3.list('s/x1/')).map((o) => o.key);
  assert.deepEqual(keys, ['s/x1/a', 's/x1/b&c', 's/x1/c']);
  await s3.delMany(keys);
  const del = r.calls.at(-1);
  assert.equal(del.method, 'POST');
  assert.equal(del.search, '?delete');
  assert.match(del.body, /<Key>s\/x1\/b&amp;c<\/Key>/);
  assert.equal(del.headers['content-md5'], createHash('md5').update(del.body).digest('base64'));
  // a missing object is not an error for head and del
  assert.equal(await s3.head('missing'), null);
  await s3.del('missing');
});

test('client: a failed call says the S3 code, not the keys', async () => {
  const r = recorder({ 'PUT /odd-b/k': { status: 403, body: '<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>' } });
  const e = await client(r.fetch).put('k', 'x').catch((x) => x);
  assert.equal(e.status, 403);
  assert.equal(e.code, 'AccessDenied');
  assert.equal(e.message, 'AccessDenied: Access Denied');
  assert.ok(!/\bS\b|secret/i.test(e.message.replace('Access', '')));
});

test('client: a copy onto itself replaces headers and tags; the bucket set-up sends the site and the terms', async () => {
  const r = recorder({ 'POST /odd-b/big.mp4?uploads': { status: 200, body: '<InitiateMultipartUploadResult><UploadId>U-1</UploadId></InitiateMultipartUploadResult>' },
    'PUT /odd-b/big.mp4?partNumber=1&uploadId=U-1': { status: 200, headers: { ETag: '"e1"' } } });
  const s3 = client(r.fetch);
  await s3.copySelf('s/x1/a b.png', { type: 'image/png', tags: { 'odd-ttl': '7' } });
  const cp = r.calls[0];
  assert.equal(cp.headers['x-amz-copy-source'], '/odd-b/s/x1/a%20b.png');
  assert.equal(cp.headers['x-amz-metadata-directive'], 'REPLACE');
  assert.equal(cp.headers['x-amz-tagging'], 'odd-ttl=7');
  await s3.putWebsite('index.html', '404.html');
  assert.match(r.calls.at(-1).body, /<Suffix>index.html<\/Suffix>.*<Key>404.html<\/Key>/);
  await s3.putLifecycle([{ id: 'odd-7', tag: ['odd-ttl', '7'], days: 7 }, { id: 'odd-30', tag: ['odd-ttl', '30'], days: 30 }]);
  const lc = r.calls.at(-1);
  assert.equal(lc.search, '?lifecycle');
  assert.match(lc.body, /<Tag><Key>odd-ttl<\/Key><Value>30<\/Value><\/Tag><\/Filter><Expiration><Days>30<\/Days>/);
  assert.equal(lc.headers['content-md5'], createHash('md5').update(lc.body).digest('base64'));
  const id = await s3.startParts('big.mp4', { type: 'video/mp4' });
  assert.equal(id, 'U-1');
  assert.equal(await s3.putPart('big.mp4', id, 1, new Uint8Array(10)), '"e1"');
  await s3.endParts('big.mp4', id, ['"e1"']);
  assert.match(r.calls.at(-1).body, /<Part><PartNumber>1<\/PartNumber><ETag>&quot;e1&quot;<\/ETag><\/Part>/);
  assert.equal(EMPTY_SHA, await sha256Hex(''));
});
