// ZIP for Oddments Web: «Скачать библиотеку целиком» (index.json + files/, what the desktop app opens unpacked) and
// «Открыть библиотеку из zip» (that, or a folder the desktop app's library was zipped from — by Windows, macOS, 7-Zip).
// Writing: stored, not compressed (pictures and video are compressed already); the archive is one Blob made of the
// headers and the files themselves — files from OPFS or the disk stay on disk, the download reads them from there. Each
// file is read once for its CRC-32. ZIP64 is written when the archive or a file passes 4 GB or 65 535 entries.
// Reading: the central directory (ZIP64 too); stored entries are slices, deflated ones go through
// DecompressionStream('deflate-raw'). Pure but for Blob and the streams: tests/unit/litezip.test.mjs.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(u8, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}
// a Blob's CRC-32, read in pieces (a big video does not land in memory whole)
export async function crcOf(blob, onBytes) {
  let crc = 0;
  const STEP = 8 * 1024 * 1024;
  for (let at = 0; at < blob.size; at += STEP) {
    const u8 = new Uint8Array(await blob.slice(at, at + STEP).arrayBuffer());
    crc = crc32(u8, crc);
    if (onBytes) onBytes(u8.length);
  }
  return crc;
}

const enc = new TextEncoder();
// the DOS date and time of a JS date, as zip keeps them
function dos(d) {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
const MAX32 = 0xffffffff;

// entries: [{ name: 'files/x/a.png', blob }] → Blob of the archive. onProgress(doneBytes, totalBytes).
export async function zipBlob(entries, onProgress) {
  const total = entries.reduce((s, e) => s + e.blob.size, 0);
  let done = 0;
  const parts = [], central = [];
  let offset = 0;
  const big = total + entries.length * 200 > MAX32 || entries.length > 0xfffe;
  for (const e of entries) {
    const name = enc.encode(e.name.replace(/\\/g, '/'));
    const crc = await crcOf(e.blob, (n) => { done += n; if (onProgress) onProgress(done, total); });
    const { time, date } = dos(e.date || new Date());
    const size = e.blob.size, z64 = big || size >= MAX32 || offset >= MAX32;
    // local header (ZIP64: sizes in the extra field, 0xffffffff in the header)
    const lx = z64 ? 20 : 0;
    const lh = new DataView(new ArrayBuffer(30 + name.length + lx));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, z64 ? 45 : 20, true); lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, z64 ? MAX32 : size, true); lh.setUint32(22, z64 ? MAX32 : size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, lx, true);
    new Uint8Array(lh.buffer).set(name, 30);
    if (z64) { const x = 30 + name.length; lh.setUint16(x, 1, true); lh.setUint16(x + 2, 16, true); setU64(lh, x + 4, size); setU64(lh, x + 12, size); }
    parts.push(lh.buffer, e.blob);
    central.push({ name, crc, size, time, date, offset, z64 });
    offset += lh.byteLength + size;
  }
  const cdStart = offset;
  for (const c of central) {
    const cx = c.z64 ? 28 : 0;
    const ch = new DataView(new ArrayBuffer(46 + c.name.length + cx));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, (3 << 8) | 45, true); ch.setUint16(6, c.z64 ? 45 : 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, c.time, true); ch.setUint16(14, c.date, true);
    ch.setUint32(16, c.crc, true); ch.setUint32(20, c.z64 ? MAX32 : c.size, true); ch.setUint32(24, c.z64 ? MAX32 : c.size, true);
    ch.setUint16(28, c.name.length, true); ch.setUint16(30, cx, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true); ch.setUint32(38, 0o100644 << 16, true); ch.setUint32(42, c.z64 ? MAX32 : c.offset, true);
    new Uint8Array(ch.buffer).set(c.name, 46);
    if (c.z64) { const x = 46 + c.name.length; ch.setUint16(x, 1, true); ch.setUint16(x + 2, 24, true); setU64(ch, x + 4, c.size); setU64(ch, x + 12, c.size); setU64(ch, x + 20, c.offset); }
    parts.push(ch.buffer);
    offset += ch.byteLength;
  }
  const cdSize = offset - cdStart, n = central.length;
  if (big || cdStart >= MAX32) {
    const z = new DataView(new ArrayBuffer(56 + 20));
    z.setUint32(0, 0x06064b50, true); setU64(z, 4, 44); z.setUint16(12, 45, true); z.setUint16(14, 45, true);
    z.setUint32(16, 0, true); z.setUint32(20, 0, true); setU64(z, 24, n); setU64(z, 32, n); setU64(z, 40, cdSize); setU64(z, 48, cdStart);
    z.setUint32(56, 0x07064b50, true); z.setUint32(60, 0, true); setU64(z, 64, offset); z.setUint32(72, 1, true);
    parts.push(z.buffer);
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Math.min(n, 0xffff), true); end.setUint16(10, Math.min(n, 0xffff), true);
  end.setUint32(12, Math.min(cdSize, MAX32), true); end.setUint32(16, Math.min(cdStart, MAX32), true);
  parts.push(end.buffer);
  return new Blob(parts, { type: 'application/zip' });
}
function setU64(dv, at, v) { dv.setUint32(at, v % 0x100000000, true); dv.setUint32(at + 4, Math.floor(v / 0x100000000), true); }
const u64 = (dv, at) => dv.getUint32(at, true) + dv.getUint32(at + 4, true) * 0x100000000;

// the entries of an archive: [{ name, method, csize, size, crc, local }]; throws on what is not a zip
export async function readZip(blob) {
  const tailLen = Math.min(blob.size, 65557 + 20);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eo = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('это не zip-архив');
  let count = tail.getUint16(eo + 10, true), cdSize = tail.getUint32(eo + 12, true), cdStart = tail.getUint32(eo + 16, true);
  // ZIP64: the locator right before the end record points at the real one
  if (eo >= 20 && tail.getUint32(eo - 20, true) === 0x07064b50) {
    const at = u64(tail, eo - 20 + 8);
    const z = new DataView(await blob.slice(at, at + 56).arrayBuffer());
    if (z.getUint32(0, true) === 0x06064b50) { count = u64(z, 32); cdSize = u64(z, 40); cdStart = u64(z, 48); }
  }
  const cd = new DataView(await blob.slice(cdStart, cdStart + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.byteLength; k++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('архив повреждён');
    const method = cd.getUint16(p + 10, true), crc = cd.getUint32(p + 16, true);
    let csize = cd.getUint32(p + 20, true), size = cd.getUint32(p + 24, true), local = cd.getUint32(p + 42, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
    // ZIP64 extra: the fields that read 0xffffffff, in this order
    for (let x = p + 46 + nl; x + 4 <= p + 46 + nl + xl;) {
      const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (size === MAX32) { size = u64(cd, q); q += 8; }
        if (csize === MAX32) { csize = u64(cd, q); q += 8; }
        if (local === MAX32) { local = u64(cd, q); q += 8; }
      }
      x += 4 + len;
    }
    if (!name.endsWith('/')) out.push({ name, method, csize, size, crc, local });
    p += 46 + nl + xl + cl;
  }
  return out;
}

// one entry's content as a Blob (stored: a slice of the archive; deflated: unpacked as a stream)
export async function entryBlob(blob, e) {
  const h = new DataView(await blob.slice(e.local, e.local + 30).arrayBuffer());
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error('архив повреждён: ' + e.name);
  const start = e.local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const raw = blob.slice(start, start + e.csize);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error(`«${e.name}» сжат способом, который браузер не открывает (${e.method})`);
  if (typeof DecompressionStream !== 'function') throw new Error('этот браузер не распаковывает zip — обновите его');
  return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
}

// where the library sits in an archive: the shallowest index.json (a zipped «Oddments Library» folder has it one level down)
export function libraryPrefix(entries) {
  const idx = entries.map((e) => e.name).filter((n) => /(^|\/)index\.json$/.test(n) && !/(^|\/)(backups|files|__MACOSX)\//.test(n))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  return idx == null ? null : idx.slice(0, -'index.json'.length);
}
