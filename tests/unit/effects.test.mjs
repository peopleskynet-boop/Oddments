// «Эффекты» (src/lib/effects.js): dither matrices and error diffusion, text cells, colours, sizes and names, and that a
// broken stored state never reaches the shader
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bayer, ditherOrdered, ditherDiffuse, bitCells, ansiCell, ansiCells, glyphCount, cmyk, adjust, nearest, TERM16,
  gridOf, outSize, copyName, settle, snapshot, DEFAULTS, seedOf, hexRgb,
} from '../../src/lib/effects.js';

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

test('bayer(4) is the classic matrix, bayer(8) holds every threshold once', () => {
  assert.deepEqual(Array.from(bayer(4), (t) => Math.round(t * 16 - 0.5)), [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
  const b8 = Array.from(bayer(8), (t) => Math.round(t * 64 - 0.5)).sort((a, b) => a - b);
  assert.deepEqual(b8, Array.from({ length: 64 }, (_, i) => i));
});

test('ordered dither: a flat grey lights its share of dots, black and white stay clean', () => {
  const w = 32, h = 32;
  for (const n of [4, 8]) {
    assert.equal(mean(ditherOrdered(new Float32Array(w * h).fill(0.25), w, h, n)), 0.25);
    assert.equal(mean(ditherOrdered(new Float32Array(w * h).fill(0), w, h, n)), 0);
    assert.equal(mean(ditherOrdered(new Float32Array(w * h).fill(1), w, h, n)), 1);
  }
});

test('error diffusion keeps the average grey; Atkinson keeps highlights and shadows clean', () => {
  const w = 64, h = 64;
  for (const v of [0.1, 0.3, 0.5, 0.8]) {
    const fs = mean(ditherDiffuse(new Float32Array(w * h).fill(v), w, h, 'fs'));
    assert.ok(Math.abs(fs - v) < 0.02, `Floyd–Steinberg ${v} → ${fs}`);
  }
  assert.ok(Math.abs(mean(ditherDiffuse(new Float32Array(w * h).fill(0.5), w, h, 'atkinson')) - 0.5) < 0.05);
  // a very light grey: Atkinson drops a quarter of the error, so it stays white; Floyd–Steinberg sprinkles dots
  assert.equal(mean(ditherDiffuse(new Float32Array(w * h).fill(0.97), w, h, 'atkinson')), 1);
  assert.ok(mean(ditherDiffuse(new Float32Array(w * h).fill(0.97), w, h, 'fs')) < 1);
  // a gradient gets more white dots towards its light end, and the same input gives the same dots
  const g = Float32Array.from({ length: w * h }, (_, i) => (i % w) / (w - 1));
  const d = ditherDiffuse(g, w, h, 'fs'), col = (x) => mean(Array.from({ length: h }, (_, y) => d[y * w + x]));
  assert.ok(col(4) < col(32) && col(32) < col(60));
  assert.deepEqual(ditherDiffuse(g, w, h, 'fs'), d);
});

test('1-bit cells: transparent counts as the light colour, contrast and brightness move the threshold', () => {
  const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 128, 128, 128, 255]);
  const p = { method: 'bayer4', contrast: 100, bright: 0 };
  assert.deepEqual(Array.from(bitCells(px, 4, 1, p)).slice(0, 3), [0, 255, 255]);
  const grey = new Uint8ClampedArray(64 * 4).fill(128);
  const on = (q) => mean(Array.from(bitCells(grey, 8, 8, { method: 'bayer8', contrast: 100, bright: 0, ...q })).map((v) => v / 255));
  assert.ok(on({ bright: 30 }) > on({}) && on({}) > on({ bright: -30 }));
});

test('text cells: brightness picks the glyph, the palette picks the colour', () => {
  const p = { ...DEFAULTS.ansi, contrast: 100 };
  const n = glyphCount('blocks');
  assert.equal(ansiCell(0, 0, 0, p).g, 0);
  assert.equal(ansiCell(1, 1, 1, p).g, n - 1);
  // on paper it is the other way round: dark cells get the most ink
  assert.equal(ansiCell(0, 0, 0, { ...p, bg: 'light' }).g, n - 1);
  // 16 colours: a bright green cell is the bright green of the palette, a dim one the dim green; black never paints
  assert.deepEqual(ansiCell(0.1, 0.9, 0.1, p).c, TERM16[10]);
  assert.deepEqual(ansiCell(0.05, 0.35, 0.05, p).c, TERM16[2]);
  assert.notDeepEqual(ansiCell(0.02, 0.02, 0.02, p).c, TERM16[0]);
  // black / white + accent: a red cell takes the accent, a grey one stays grey or white
  const acc = { ...p, pal: 'accent', accent: '#ff0000' };
  assert.deepEqual(ansiCell(0.9, 0.1, 0.1, acc).c, [1, 0, 0]);
  assert.deepEqual(ansiCell(0.8, 0.8, 0.8, acc).c, [0.95, 0.95, 0.95]);
  // own colour: three levels per channel
  const own = ansiCell(0.8, 0.4, 0.1, { ...p, pal: 'own' }).c;
  assert.ok(own.every((v) => [0, 0.5, 1].some((lv) => Math.abs(v / Math.max(...own) - lv) < 1e-6)));
  // the grid packs colour and glyph; a transparent cell is the background → empty on a dark screen
  const cells = ansiCells(new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 0]), 2, 1, p);
  assert.equal(cells[3], n - 1);
  assert.equal(cells[7], 0);
});

test('colour helpers', () => {
  assert.deepEqual(cmyk(1, 1, 1), [0, 0, 0, 0]);
  assert.deepEqual(cmyk(0, 0, 0), [0, 0, 0, 1]);
  assert.deepEqual(cmyk(1, 0, 0), [0, 1, 1, 0]);
  assert.equal(adjust(0.5, 200), 0.5);
  assert.equal(adjust(0.9, 200), 1);
  assert.equal(adjust(0.5, 100, 20), 0.7);
  assert.deepEqual(nearest(TERM16, 0.95, 0.95, 0.95), TERM16[15]);
  assert.deepEqual(hexRgb('#ff8000'), [1, 128 / 255, 0]);
});

test('sizes: square cells, at least 2048 on the long side, at most 40 MP', () => {
  assert.deepEqual(gridOf(1000, 500, 100), { cols: 100, rows: 50 });
  assert.deepEqual(gridOf(500, 1000, 100), { cols: 100, rows: 200 });
  assert.deepEqual(outSize(1000, 500), { w: 2048, h: 1024 });
  assert.deepEqual(outSize(4000, 3000), { w: 4000, h: 3000 });
  const big = outSize(10000, 8000);
  assert.ok(big.w * big.h <= 40e6 + 20000 && Math.abs(big.w / big.h - 1.25) < 0.001);
});

test('names: «Имя · ANSI · CRT.png», a missing step leaves no dot', () => {
  assert.equal(copyName('Постер.jpg', 'ansi', 'crt'), 'Постер · ANSI · CRT.png');
  assert.equal(copyName('Постер.jpg', 'none', 'crt'), 'Постер · CRT.png');
  assert.equal(copyName('a.b.psd', 'bit', 'none'), 'a.b · 1-bit.png');
  assert.equal(copyName('x.png', 'tone', 'fiche'), 'x · Halftone · Fiche.png');
});

test('settle: a broken or foreign state comes back whole and valid; a snapshot keeps the two used effects', () => {
  assert.deepEqual(settle(null), DEFAULTS);
  const s = settle({ look: 'bit', media: 'tv', bit: { dots: 99999, method: 'magic', dark: 'red', bright: '7' }, ansi: 'x', crt: { glow: -5 } });
  assert.equal(s.look, 'bit');
  assert.equal(s.media, DEFAULTS.media);
  assert.equal(s.bit.dots, 1200);
  assert.equal(s.bit.method, DEFAULTS.bit.method);
  assert.equal(s.bit.dark, DEFAULTS.bit.dark);
  assert.equal(s.bit.bright, 7);
  assert.deepEqual(s.ansi, DEFAULTS.ansi);
  assert.equal(s.crt.glow, 0);
  const e = snapshot({ ...DEFAULTS, look: 'tone', media: 'fiche' });
  assert.deepEqual(Object.keys(e).sort(), ['fiche', 'look', 'media', 'tone']);
  assert.deepEqual(settle(e).tone, DEFAULTS.tone);
  assert.equal(seedOf('abc'), seedOf('abc'));
  assert.notEqual(seedOf('abc'), seedOf('abd'));
});
