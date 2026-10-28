// The presentation's PDF (src/lib/pdf.js): a valid structure — objects at the offsets the xref table says
import test from 'node:test';
import assert from 'node:assert/strict';
import { imagesToPdf } from '../../src/lib/pdf.js';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // the smallest «JPEG»: start and end markers (enough for the structure)

test('every object sits where the xref table points', () => {
  const pdf = imagesToPdf([{ jpeg, w: 1920, h: 1080 }, { jpeg, w: 1920, h: 1080 }]);
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  const xref = +text.match(/startxref\n(\d+)/)[1];
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const rows = text.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l));
  assert.equal(rows.length, 2 + 2 * 3); // catalog, pages, three per page
  rows.forEach((r, i) => assert.equal(text.slice(+r.slice(0, 10), +r.slice(0, 10) + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/Filter \/DCTDecode \/Length 4/);
});
