// A saved link and what its page says about itself (src/lib/linkmeta.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readShortcut, writeShortcut, pageMeta, siteName, hostOf, placeholderName, decodeEntities, bestIcon } from '../../src/lib/linkmeta.js';

test('a plain shortcut gives its address', () => {
  assert.deepEqual(readShortcut('[InternetShortcut]\r\nURL=https://sketchfab.com/3d-models/x-1\r\n'),
    { url: 'https://sketchfab.com/3d-models/x-1', image: '', title: '', desc: '', site: '', icon: '' });
  assert.equal(readShortcut('URL=https://a.com/b').url, 'https://a.com/b'); // written without a section
});

test('the [Oddments] section carries the page as the browser saw it', () => {
  const text = writeShortcut({ url: 'https://www.artstation.com/marketplace/p/3LAqv', title: 'Pixel 11 Pro\nOlive', desc: 'Blend, 4K', image: 'https://cdna.artstation.com/p/1.jpg', site: 'ArtStation' });
  assert.match(text, /^\[InternetShortcut\]\r\nURL=https:\/\/www\.artstation\.com\/marketplace\/p\/3LAqv\r\n\[Oddments\]\r\n/);
  const r = readShortcut(text);
  assert.equal(r.url, 'https://www.artstation.com/marketplace/p/3LAqv');
  assert.equal(r.title, 'Pixel 11 Pro Olive'); // a line break cannot sneak into the file
  assert.equal(r.desc, 'Blend, 4K');
  assert.equal(r.image, 'https://cdna.artstation.com/p/1.jpg');
  assert.equal(r.site, 'ArtStation');
  // a shot of the page as data; any other kind of address is not a picture
  assert.equal(readShortcut('[InternetShortcut]\nURL=https://a.com\n[Oddments]\nImage=data:image/jpeg;base64,AAAA').image, 'data:image/jpeg;base64,AAAA');
  assert.equal(readShortcut('[InternetShortcut]\nURL=https://a.com\n[Oddments]\nImage=file:///C:/secret.png').image, '');
  assert.equal(readShortcut('[InternetShortcut]\nURL=https://a.com\n[Oddments]\nImage=javascript:alert(1)').image, '');
  // the URL of another section is not the link
  assert.equal(readShortcut('[Oddments]\nURL=https://evil.com\n[InternetShortcut]\nURL=https://good.com').url, 'https://good.com');
});

test('the page head: Open Graph first, then Twitter, <title>, the description', () => {
  const html = `<!doctype html><html><head>
    <title>iPhone 17 Pro - Download Free 3D model by Ranguel [4541aa8] - Sketchfab</title>
    <meta property="og:title" content="iPhone 17 Pro - Download Free 3D model by Ranguel">
    <meta content="Clean model &amp; textures" property="og:description">
    <meta property="og:site_name" content="Sketchfab">
    <meta property="og:image" content="//media.sketchfab.com/models/a/thumbnails/b/c.jpeg">
    <link rel="apple-touch-icon" sizes="180x180" href="/static/apple.png">
    <link rel="icon" href="/favicon.ico">
  </head><body><meta property="og:image" content="https://evil.com/x.png"></body></html>`;
  const m = pageMeta(html, 'https://sketchfab.com/3d-models/iphone-17-pro-4541');
  assert.equal(m.title, 'iPhone 17 Pro - Download Free 3D model by Ranguel');
  assert.equal(m.desc, 'Clean model & textures');
  assert.equal(m.site, 'Sketchfab');
  assert.equal(m.image, 'https://media.sketchfab.com/models/a/thumbnails/b/c.jpeg');
  assert.equal(m.icon, 'https://sketchfab.com/static/apple.png');
  // no og:title — the <title>; no icons named — /favicon.ico; single quotes and odd case
  const m2 = pageMeta("<HEAD><TITLE>Rotato &#8211; 14 ideas</TITLE><META NAME='description' CONTENT='Video mockups'></HEAD>", 'https://rotato.app/blog/x');
  assert.equal(m2.title, 'Rotato – 14 ideas');
  assert.equal(m2.desc, 'Video mockups');
  assert.equal(m2.image, '');
  assert.equal(m2.icon, 'https://rotato.app/favicon.ico');
  // a picture that is not a web address is dropped
  assert.equal(pageMeta('<head><meta property="og:image" content="javascript:alert(1)"></head>', 'https://a.com').image, '');
});

test('the sharpest icon is taken', () => {
  const base = 'https://a.com/';
  const ic = (rel, href, sizes = '', type = '') => ({ rel: rel.split(' '), href, sizes, type });
  assert.equal(bestIcon([ic('icon', '/f.ico'), ic('icon', '/i32.png', '32x32'), ic('icon', '/i192.png', '192x192')], base), 'https://a.com/i192.png');
  assert.equal(bestIcon([ic('icon', '/i32.png', '32x32'), ic('icon', '/logo.svg', '', 'image/svg+xml')], base), 'https://a.com/logo.svg');
  assert.equal(bestIcon([], base), 'https://a.com/favicon.ico');
});

test('the site name on the pill', () => {
  assert.equal(siteName('https://sketchfab.com/x', 'Sketchfab'), 'Sketchfab');
  assert.equal(siteName('https://superhivemarket.com/p', 'Superhive (formerly Blender Market)'), 'superhivemarket');
  assert.equal(siteName('https://www.renderhub.com/kstore/x'), 'renderhub');
  assert.equal(siteName('https://atomicdesign.bradfrost.com/ch2'), 'bradfrost');
  assert.equal(siteName('https://t.me/designdodo/418'), 't.me');
  assert.equal(siteName('https://shop.example.co.uk/x'), 'example');
  assert.equal(siteName('https://9to5google.com/x', 'Google | 9to5'), '9to5google'); // a long or split own name — the domain
  assert.equal(hostOf('https://www.ArtStation.com/a'), 'artstation.com');
});

test('only an auto-made name gives way to the page title', () => {
  assert.equal(placeholderName('sketchfab.com', 'https://sketchfab.com/x'), true);
  assert.equal(placeholderName('www.sketchfab.com', 'https://sketchfab.com/x'), true);
  assert.equal(placeholderName('YouTube dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ'), true);
  assert.equal(placeholderName('', 'https://a.com'), true);
  assert.equal(placeholderName('БЕСПЛАТНО iPhone 17 Pro - Ranguel, CC BY, Sketchfab', 'https://sketchfab.com/x'), false);
});

test('entities', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#x2014; &laquo;ок&raquo; &#39;x&#39; &bogus;'), "Tom & Jerry — «ок» 'x' &bogus;");
});
