// Joins a video-only and an audio-only fragmented MP4 (CMAF: what HLS players get as `_720w.cmfv` + `_audio.cmfa`,
// Pinterest's videos since 2026) into one MP4 that plays anywhere, without re-encoding. The video's moov gets the audio
// track (its own id, its trex), the fragments of both go in time order with fresh sequence numbers. Data offsets in
// CMAF are relative to each moof (default-base-is-moof), so the fragments move as they are.
// The same file lives in integrations/browser/fmp4.js for the browser extension — keep them equal.

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const put32 = (b, o, v) => { b[o] = v >>> 24; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; };
const type = (b, o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);

// the boxes in b[from, to): { type, start, end, head } (head — 8, or 16 for a 64-bit size)
function boxes(b, from = 0, to = b.length) {
  const out = [];
  for (let o = from; o + 8 <= to;) {
    let size = u32(b, o), head = 8;
    if (size === 1) { size = u32(b, o + 8) * 2 ** 32 + u32(b, o + 12); head = 16; } else if (size === 0) size = to - o;
    if (size < head || o + size > to) break;
    out.push({ type: type(b, o), start: o, end: o + size, head });
    o += size;
  }
  return out;
}
const kids = (b, box) => boxes(b, box.start + box.head, box.end);
const find = (b, box, t) => kids(b, box).find((k) => k.type === t);
const copy = (b, box) => b.slice(box.start, box.end);
function wrap(t, parts) {
  const len = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  put32(out, 0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = t.charCodeAt(i);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// tkhd / tfhd / trex keep the track id at a known place (tkhd: after the times, which are 64-bit in version 1)
const tkhdId = (b, box) => box.start + box.head + (b[box.start + box.head] === 1 ? 20 : 12);
const timescale = (b, trak) => {
  const mdhd = find(b, find(b, trak, 'mdia'), 'mdhd');
  return u32(b, mdhd.start + mdhd.head + (b[mdhd.start + mdhd.head] === 1 ? 20 : 12)) || 1;
};

function fragments(b, top, scale, id) {
  const out = [];
  for (let i = 0; i < top.length; i++) {
    if (top[i].type !== 'moof') continue;
    const moof = copy(b, top[i]);
    const mdat = top[i + 1] && top[i + 1].type === 'mdat' ? copy(b, top[i + 1]) : new Uint8Array(0);
    let t = 0;
    for (const traf of kids(moof, { start: 0, head: 8, end: moof.length }).filter((k) => k.type === 'traf')) {
      const tfhd = find(moof, traf, 'tfhd');
      if (id != null && tfhd) put32(moof, tfhd.start + tfhd.head + 4, id);
      const tfdt = find(moof, traf, 'tfdt');
      if (tfdt) {
        const v1 = moof[tfdt.start + tfdt.head] === 1, o = tfdt.start + tfdt.head + 4;
        t = (v1 ? u32(moof, o) * 2 ** 32 + u32(moof, o + 4) : u32(moof, o)) / scale;
      }
    }
    out.push({ moof, mdat, t });
  }
  return out;
}

export function muxAV(video, audio) {
  const v = video instanceof Uint8Array ? video : new Uint8Array(video);
  const a = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  const vt = boxes(v), at = boxes(a);
  const vMoov = vt.find((x) => x.type === 'moov'), aMoov = at.find((x) => x.type === 'moov');
  if (!vMoov || !aMoov) throw new Error('not a fragmented MP4');
  const vTrak = kids(v, vMoov).filter((k) => k.type === 'trak');
  const aTrak = kids(a, aMoov).find((k) => k.type === 'trak');
  const vId = Math.max(...vTrak.map((t) => u32(v, tkhdId(v, find(v, t, 'tkhd')))));
  const id = vId + 1;
  // the audio track under its new id
  const trak = copy(a, aTrak);
  const tk = find(trak, { start: 0, head: 8, end: trak.length }, 'tkhd');
  put32(trak, tkhdId(trak, tk), id);
  const aMvex = find(a, aMoov, 'mvex');
  const trex = aMvex && kids(a, aMvex).find((k) => k.type === 'trex');
  if (!trex) throw new Error('no trex');
  const trexB = copy(a, trex);
  put32(trexB, 12, id);
  // the video's moov: mvhd (next track id), its tracks, the audio track, mvex with both trex, the rest as is
  const parts = [];
  let mvex = null;
  for (const k of kids(v, vMoov)) {
    if (k.type === 'mvhd') { const m = copy(v, k); put32(m, m.length - 4, id + 1); parts.push(m); }
    else if (k.type === 'mvex') mvex = wrap('mvex', [...kids(v, k).map((x) => copy(v, x)), trexB]);
    else parts.push(copy(v, k));
  }
  const lastTrak = parts.reduce((n, p, i) => (type(p, 0) === 'trak' ? i : n), 0);
  parts.splice(lastTrak + 1, 0, trak);
  if (mvex) parts.push(mvex);
  const moov = wrap('moov', parts);
  const ftyp = vt.find((x) => x.type === 'ftyp');
  const frags = [
    ...fragments(v, vt, timescale(v, vTrak[0]), null),
    ...fragments(a, at, timescale(a, aTrak), id),
  ].sort((x, y) => x.t - y.t);
  frags.forEach((f, i) => {
    const mfhd = find(f.moof, { start: 0, head: 8, end: f.moof.length }, 'mfhd');
    if (mfhd) put32(f.moof, mfhd.start + mfhd.head + 4, i + 1);
  });
  const all = [ftyp ? copy(v, ftyp) : new Uint8Array(0), moov, ...frags.flatMap((f) => [f.moof, f.mdat])];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// Pinterest's HLS of one video (…/videos/iht/hls/ab/cd/ef/<hash>.m3u8): the best video rendition as a whole file
// (its playlist maps byte ranges of one .cmfv) and the audio (.cmfa), when there is audio. `get(url)` → Response.
export async function pinterestHls(m3u8, get) {
  const base = m3u8.replace(/[^/]*$/, '');
  const master = await (await get(m3u8)).text();
  let best = null, bestH = -1, audio = '';
  const lines = master.split(/\r?\n/);
  lines.forEach((l, i) => {
    const am = l.match(/^#EXT-X-MEDIA:.*TYPE=AUDIO.*URI="([^"]+)"/);
    if (am && !audio) audio = am[1];
    const sm = l.match(/^#EXT-X-STREAM-INF:.*RESOLUTION=(\d+)x(\d+)/);
    if (sm && +sm[2] * +sm[1] > bestH && lines[i + 1]) { bestH = +sm[2] * +sm[1]; best = lines[i + 1].trim(); }
  });
  if (!best) throw new Error('no video in the playlist');
  const fileOf = async (pl) => {
    const text = await (await get(base + pl)).text();
    const m = text.match(/#EXT-X-MAP:URI="([^"]+)"/) || text.match(/^([^#\s][^\s]*)$/m);
    if (!m) throw new Error('no media file');
    const r = await get(base + m[1]);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  };
  const vid = await fileOf(best);
  if (!audio) return vid;
  let aud = null;
  try { aud = await fileOf(audio); } catch (e) { return vid; }
  return muxAV(vid, aud);
}
