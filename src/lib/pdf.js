// A PDF of pictures, one per page — the presentation's export (show.js). Each page is a JPEG drawn by the caller (the
// slide with its caption and comments already on it), so no fonts are needed: Cyrillic is pixels like everything else.
// The smallest valid PDF 1.4: a catalog, a page tree, and per page a page, an image (DCTDecode — the JPEG as it is)
// and a content stream that draws it over the whole page. Pure: bytes in, bytes out.
const enc = new TextEncoder();

// pages: [{ jpeg: Uint8Array, w, h }] (w, h — the picture's pixels); size: the page in points (72 per inch)
export function imagesToPdf(pages, { pageW = 960, pageH = 540 } = {}) {
  const chunks = [];
  let len = 0;
  const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length, first = 3; // 1 catalog, 2 pages, then 3 objects per page: page, image, content
  const kids = pages.map((_, i) => `${first + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  pages.forEach((p, i) => {
    const pg = first + i * 3, im = pg + 1, ct = pg + 2;
    const draw = enc.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`);
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    obj(im, `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
    obj(ct, `<< /Length ${draw.length} >>`, draw);
  });
  const xref = len, total = first + n * 3;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
