// Reading other apps' libraries, without the disk (importers.js does the files). Pure functions, tested in
// tests/unit/importfmt.test.mjs.
//
// Eagle (eagle.cool): <name>.library/metadata.json holds the folder tree ({ folders: [{ id, name, children }] });
// every file is images/<ID>.info/ with the original, <name>_thumbnail.png and metadata.json
// ({ id, name, ext, tags, folders, annotation, url, btime, isDeleted, comments, star }). Eagle's stars are not carried
// over: Oddments has no ratings.
// PureRef (.pur): a closed binary format (Qt's data stream). The pictures in it are whole PNG / JPEG / WebP files one
// after another; they are found by their own structure (chunks, segments), each to its exact end. The board layout
// (positions, scale, notes) is not read.

// Eagle's folder tree, parents before children: [{ id, name, parent }]
export function eagleFolders(meta) {
  const out = [];
  const walk = (list, parent) => {
    for (const f of Array.isArray(list) ? list : []) {
      if (!f || !f.id) continue;
      out.push({ id: String(f.id), name: String(f.name || 'Без названия').slice(0, 200), parent });
      walk(f.children, String(f.id));
    }
  };
  walk(meta && meta.folders, null);
  return out;
}

// the Oddments fields of one Eagle file (only fields index.json already knows, plus the optional `eagle` id that
// lets a second import skip what is already in); null — leave it out (in Eagle's trash, or not a file record)
export function eagleItem(m, folderIds) {
  if (!m || !m.id || m.isDeleted) return null;
  const notes = [m.annotation, ...(Array.isArray(m.comments) ? m.comments.map((c) => c && c.annotation) : [])].map((s) => String(s || '').trim()).filter(Boolean);
  const folders = (Array.isArray(m.folders) ? m.folders : []).map((id) => folderIds.get(String(id))).filter(Boolean);
  const added = +m.btime || +m.modificationTime || 0, name = String(m.name || '').trim().slice(0, 300);
  return {
    ...(name ? { name } : {}),
    tags: [...new Set((Array.isArray(m.tags) ? m.tags : []).map((t) => String(t).trim()).filter(Boolean))],
    folders,
    note: notes.join('\n\n'),
    url: /^https?:\/\//i.test(m.url || '') ? m.url : '',
    ...(added > 0 && added <= Date.now() ? { added } : {}),
    eagle: String(m.id),
  };
}

// which file of an .info folder is the original: not Eagle's metadata, not its thumbnail; the one named like the
// record when there are several
export function eagleOriginal(names, m) {
  const files = names.filter((n) => n !== 'metadata.json' && !/_thumbnail\.png$/i.test(n) && !n.startsWith('.'));
  const want = m && m.name != null && m.ext ? `${m.name}.${m.ext}`.toLowerCase() : '';
  return files.find((n) => n.toLowerCase() === want) || files.find((n) => m && m.ext && n.toLowerCase().endsWith('.' + String(m.ext).toLowerCase())) || files[0] || null;
}

/* ---------- pictures inside a binary file (PureRef) ---------- */
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// the end of a PNG that starts at i (after its IEND chunk), or -1
function pngEnd(b, i) {
  let p = i + 8;
  while (p + 12 <= b.length) {
    const len = u32(b, p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (!/^[A-Za-z]{4}$/.test(type) || len > b.length) return -1;
    p += 12 + len;
    if (type === 'IEND') return p <= b.length ? p : -1;
  }
  return -1;
}

// the end of a JPEG that starts at i (after its EOI marker), or -1: segments by their lengths, the scan data up to the
// next marker that is not stuffing (FF 00) or a restart (FF D0–D7)
function jpegEnd(b, i) {
  let p = i + 2, frame = false;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return -1;
    while (b[p] === 0xff && p < b.length) p++;
    const m = b[p++];
    if (m === 0xd9) return frame ? p : -1;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
    const len = (b[p] << 8) | b[p + 1];
    if (len < 2) return -1;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) frame = true;
    p += len;
    if (m === 0xda) {
      while (p + 1 < b.length && !(b[p] === 0xff && b[p + 1] !== 0 && !(b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7))) p++;
    }
  }
  return -1;
}

// [{ start, end, type }] of every whole picture in the bytes, in order; a picture inside another (a JPEG's own
// thumbnail) is skipped with it
export function scanImages(b) {
  const out = [];
  let i = 0;
  while (i < b.length - 12) {
    let end = -1, type = '';
    if (b[i] === 0x89 && PNG.every((v, k) => b[i + k] === v)) { end = pngEnd(b, i); type = 'png'; }
    else if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) { end = jpegEnd(b, i); type = 'jpg'; }
    else if (b[i] === 0x52 && b[i + 1] === 0x49 && b[i + 2] === 0x46 && b[i + 3] === 0x46 && b[i + 8] === 0x57 && b[i + 9] === 0x45 && b[i + 10] === 0x42 && b[i + 11] === 0x50) {
      const size = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
      end = i + 8 + size <= b.length ? i + 8 + size : -1; type = 'webp';
    }
    if (end > i) { out.push({ start: i, end, type }); i = end; } else i++;
  }
  return out;
}
