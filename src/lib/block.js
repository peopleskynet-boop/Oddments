// A block of a page's layout, grabbed by the browser extension («Забрать блок», integrations/browser/block.js):
// an .oddblock file is a ZIP of shot.png (the block as it looked, screens joined), block.html (its markup with the
// computed styles inlined, fonts inside) and block.json (page, kind, size, fonts, colours). One file per block, so the
// library format does not change; the thumbnail is the shot.
import { unzipSync, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';

const PARTS = new Set(['shot.png', 'block.html', 'block.json']);

export function readBlock(u8) {
  const z = unzipSync(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8), { filter: (f) => PARTS.has(f.name) });
  let meta = {};
  try { meta = z['block.json'] ? JSON.parse(strFromU8(z['block.json'])) : {}; } catch (e) { meta = {}; }
  return {
    shot: z['shot.png'] ? new Blob([z['shot.png']], { type: 'image/png' }) : null,
    html: z['block.html'] ? strFromU8(z['block.html']) : '',
    meta,
  };
}

// the card's picture: a very long block shows its top (no taller than 2.5 of its width), a thin strip (a menu, a
// button row) sits on its own background with room around it, so the grid does not crop it to its middle
export function blockCover(bm, bg, max = 640) {
  const sh = Math.min(bm.height, Math.round(bm.width * 2.5));
  const s = Math.min(1, max / Math.max(bm.width, sh));
  const w = Math.max(1, Math.round(bm.width * s)), h = Math.max(1, Math.round(sh * s));
  const H = Math.max(h, Math.round(w * 0.42)), pad = h < H ? Math.round(w * 0.06) : 0;
  const c = document.createElement('canvas');
  c.width = w + pad * 2; c.height = H + pad * 2;
  const x = c.getContext('2d');
  x.fillStyle = bg || '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bm, 0, 0, bm.width, sh, pad, Math.round((c.height - h) / 2), w, h);
  return c;
}

// the markup for the live view: no scripts, frames, forms' actions or handlers (the frame has no scripts anyway)
export async function safeHtml(html) {
  const DOMPurify = (await import('dompurify')).default;
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style', 'use'],
    ADD_ATTR: ['data-ob', 'xlink:href', 'open'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link'],
    // a site's own elements (GitHub's include-fragment…) carry layout: without them their content falls apart
    CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /^[a-z][\w.]*-[\w.-]*$/, attributeNameCheck: /^[a-z][\w-]*$/, allowCustomizedBuiltInElements: false },
  });
  return '<!doctype html>' + clean;
}
