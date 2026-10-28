// Demo library for the browser build: procedural images in a few kinds, folders and tags.
// ?n=5000 in the address bar makes a big library for scroll-performance checks;
// ?empty starts with an empty library.
import { demoModels, demoMaterials } from './seed3d.js';
import { demoBlocks } from './seedblock.js';

const ROOT = '/Documents/Oddments Library';

const PALETTES = [
  ['#e8e2d6', '#c4532f', '#1f2a2e', '#d9a441'],
  ['#0f1418', '#e9e4da', '#5b7f6e', '#b9a17c'],
  ['#f3efe6', '#20262b', '#7d8f9b', '#c97b63'],
  ['#1b1d22', '#f25c2a', '#f7c8a8', '#3e4b5a'],
  ['#dfe5df', '#2c3b34', '#9cb7a5', '#e3b23c'],
  ['#2a1f1d', '#d8c3a5', '#8e6c55', '#e9dccb'],
  ['#101820', '#fee715', '#f2f2f2', '#4a4a4a'],
  ['#efe9f4', '#5b4b8a', '#ffb4a2', '#1c1c1c'],
  ['#14213d', '#fca311', '#e5e5e5', '#000000'],
  ['#f6f1eb', '#a3b18a', '#3a5a40', '#dad7cd'],
];
const TAGS = ['сетка', 'типографика', 'цвет', 'постер', 'интерфейс', 'фото', 'свет', 'текстура', 'минимализм', 'лого', 'упаковка', 'иллюстрация'];
const WORDS = ['Север', 'Плотность', 'Тишина', 'Форма', 'Ритм', 'Контраст', 'Поле', 'Шум', 'Слой', 'Линия', 'Тон', 'Вес'];
const RATIOS = [[4, 5], [3, 4], [1, 1], [16, 9], [2, 3], [3, 2], [9, 16], [5, 4], [21, 9]];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function draw(x, w, h, r, pal, style) {
  const [bg, a, b, c] = pal;
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  if (style === 0) { // soft photo-like blobs
    for (let i = 0; i < 6; i++) {
      const g = x.createRadialGradient(r() * w, r() * h, 0, r() * w, r() * h, (0.3 + r() * 0.6) * Math.max(w, h));
      g.addColorStop(0, [a, b, c][i % 3] + 'cc'); g.addColorStop(1, bg + '00');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    }
  } else if (style === 1) { // swiss grid
    const cols = 3 + Math.floor(r() * 4), cw = w / cols;
    for (let i = 0; i < cols * 2; i++) {
      x.fillStyle = [a, b, c][Math.floor(r() * 3)];
      x.fillRect(Math.floor(r() * cols) * cw, r() * h, cw * (1 + Math.floor(r() * 2)), h * (0.05 + r() * 0.3));
    }
  } else if (style === 2) { // circles
    const cx = w * (0.3 + r() * 0.4), cy = h * (0.3 + r() * 0.4);
    for (let i = 7; i > 0; i--) {
      x.beginPath(); x.arc(cx, cy, (i / 7) * Math.min(w, h) * 0.45, 0, Math.PI * 2);
      x.fillStyle = i % 2 ? a : c; x.fill();
    }
  } else if (style === 3) { // stripes
    x.save(); x.translate(w / 2, h / 2); x.rotate((Math.floor(r() * 4) * Math.PI) / 4);
    const n = 6 + Math.floor(r() * 18), d = Math.hypot(w, h);
    for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? a : b; x.fillRect(-d / 2 + (i * d) / n, -d / 2, d / n / 2, d); }
    x.restore();
  } else { // type poster
    x.fillStyle = a; x.fillRect(0, h * 0.62, w, h * 0.38);
    x.fillStyle = b; x.textBaseline = 'alphabetic';
    x.font = `700 ${Math.round(w * 0.2)}px Georgia, serif`;
    x.fillText(WORDS[Math.floor(r() * WORDS.length)], w * 0.06, h * 0.55);
    x.font = `${Math.round(w * 0.035)}px "Courier New", monospace`;
    x.fillStyle = c; x.fillText('Oddments — референс №' + Math.floor(r() * 900 + 100), w * 0.06, h * 0.7);
  }
  // fine grain so it reads less like flat vector art (one shared noise tile)
  x.save(); x.globalAlpha = 0.07; x.globalCompositeOperation = 'overlay';
  x.fillStyle = x.createPattern(noiseTile(), 'repeat'); x.fillRect(0, 0, w, h);
  x.restore();
}

let noise = null;
function noiseTile() {
  if (noise) return noise;
  noise = document.createElement('canvas'); noise.width = noise.height = 128;
  const x = noise.getContext('2d'), img = x.createImageData(128, 128), r = rng(7);
  for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  return noise;
}

const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

async function makeImage(i) {
  const r = rng(i * 7919 + 13);
  const [rw, rh] = RATIOS[i % RATIOS.length];
  const w = 560, h = Math.round((w * rh) / rw);
  const pal = PALETTES[Math.floor(r() * PALETTES.length)];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h, r, pal, i % 5);
  return { blob: await toBlob(c, 'image/jpeg', 0.86), w, h, colors: pal.slice(0, 4) };
}

async function makeSpecial(kind, i) {
  const c = document.createElement('canvas'); c.width = 640; c.height = kind === 'pdf' ? 830 : 360;
  const x = c.getContext('2d');
  if (kind === 'audio') {
    x.fillStyle = '#1b1f23'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#3ec7bd';
    const r = rng(i);
    for (let k = 0; k < 96; k++) { const hh = 8 + r() * 230; x.fillRect(k * 6.66 + 1.5, 180 - hh / 2, 3.6, hh); }
  } else if (kind === 'font') {
    x.fillStyle = '#e9ebee'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#14171a';
    x.textAlign = 'center'; x.font = 'italic 170px Georgia, serif'; x.fillText('Aa', 320, 210);
    x.font = '28px Georgia, serif'; x.fillText('Абвгд 0123456789', 320, 310);
  } else if (kind === 'pdf') {
    x.fillStyle = '#fbfaf7'; x.fillRect(0, 0, 640, 830); x.fillStyle = '#1a1a1a';
    x.font = '700 44px Georgia, serif'; x.fillText('Бренд-бук', 56, 120);
    x.fillStyle = '#bbb'; for (let k = 0; k < 16; k++) x.fillRect(56, 180 + k * 34, 300 + ((k * 97) % 230), 10);
    x.fillStyle = '#c4532f'; x.fillRect(56, 740, 160, 40);
  } else { // video / psd: reuse a picture
    const im = await makeImage(i + 500);
    const bmp = await createImageBitmap(im.blob);
    x.drawImage(bmp, 0, 0, 640, 360);
  }
  return { blob: await toBlob(c, 'image/jpeg', 0.86), w: c.width, h: c.height };
}

const DEMO_SVG = [
  ['Сердце', '#ff5f6d', 'M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.6 5c2 0 3.6 1.1 4.4 2.6h.1C11.9 6.1 13.4 5 15.4 5 19 5 21 8.6 19.6 11.8 17.5 16.4 12 21 12 21z'],
  ['Звезда', '#ffd23f', 'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z'],
  ['Кольцо', '#7fd4ff', 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zm0 5a5 5 0 1 1 0 10a5 5 0 1 1 0-10z', true],
  ['Буква P', '#c8f169', 'M5 3h8.5a6 6 0 0 1 0 12H9.5v6H5zM9.5 7v4h4a2 2 0 0 0 0-4z', true],
  ['Облако', '#e9e9ee', 'M7 19a5 5 0 0 1-.7-9.95A6.5 6.5 0 0 1 18.7 9.6 4.75 4.75 0 0 1 18 19z'],
];

export async function seed(put) {
  const q = new URLSearchParams(location.search);
  if (q.has('empty')) return;
  const total = Math.max(1, Number(q.get('n')) || 140);
  const day = 86400000, now = Date.now();
  const folders = [
    { id: 'f-type', name: 'Типографика', parent: null, open: true },
    { id: 'f-ui', name: 'Интерфейсы', parent: null, open: true },
    { id: 'f-post', name: 'Плакаты', parent: null, open: true },
    { id: 'f-swiss', name: 'Швейцарский стиль', parent: 'f-post', open: true },
    { id: 'f-color', name: 'Цвет и свет', parent: null, open: true },
    { id: 'f-3d', name: '3D', parent: null, open: true },
    { id: 'f-icons', name: 'Иконки', parent: null, open: true },
  ];
  const pool = [];
  for (let i = 0; i < Math.min(total, 60); i++) pool.push(await makeImage(i));
  const specials = { video: ['mp4', 74], audio: ['mp3', 212], font: ['otf', 0], pdf: ['pdf', 0], gif: ['gif', 0], psd: ['psd', 0] };
  const specialBlobs = {};
  for (const [k, n] of [['video', 1], ['audio', 2], ['font', 3], ['pdf', 4], ['psd', 5]]) specialBlobs[k] = await makeSpecial(k, n);

  const items = [];
  const r = rng(42);
  for (let i = 0; i < total; i++) {
    const id = 'demo' + i.toString(36).padStart(4, '0');
    let kind = 'image', ext = i % 3 ? 'jpg' : 'png', src = pool[i % pool.length], duration = 0, pages = 0;
    if (i % 17 === 5) kind = 'video'; else if (i % 23 === 7) kind = 'audio'; else if (i % 29 === 11) kind = 'font';
    else if (i % 31 === 13) kind = 'pdf'; else if (i % 37 === 17) kind = 'psd'; else if (i % 19 === 3) kind = 'gif';
    if (kind !== 'image') {
      ext = specials[kind][0];
      if (kind !== 'gif') src = { ...specialBlobs[kind], colors: kind === 'audio' || kind === 'font' ? [] : src.colors };
      duration = specials[kind][1] ? specials[kind][1] + (i % 40) : 0;
      pages = kind === 'pdf' ? 12 : 0;
    }
    const name = WORDS[i % WORDS.length] + ' ' + (i + 1);
    const file = `files/${id}/${name}.${ext}`, thumb = `files/${id}/thumb.webp`;
    put(`${ROOT}/${file}`, src.blob);
    put(`${ROOT}/${thumb}`, src.blob);
    const tags = TAGS.filter(() => r() < 0.18).slice(0, 3);
    const f = r();
    items.push({
      id, name, ext, kind, size: src.blob.size, added: now - Math.floor(r() * 60 * day),
      file, thumb, preview: null, w: src.w, h: src.h, ar: src.h / src.w, duration, pages,
      tags, folders: f < 0.55 ? [folders[Math.floor(f * 9) % folders.length].id] : [],
      note: i % 9 === 0 ? 'Обратить внимание на ритм и поля.' : '', url: i % 4 === 0 ? 'https://example.com/ref/' + id : '',
      colors: src.colors || [], trashed: i % 41 === 40, fresh: i % 9 === 1, fav: i % 13 === 4,
    });
  }
  // 3D: procedural GLB scenes and a .blend with an embedded preview
  (await demoModels()).forEach((m, k) => {
    const id = 'demo3d' + k, file = `files/${id}/${m.name}.${m.ext}`, thumb = m.thumb ? `files/${id}/thumb.webp` : null;
    put(`${ROOT}/${file}`, m.blob);
    if (thumb) put(`${ROOT}/${thumb}`, m.thumb);
    items.push({
      id, name: m.name, ext: m.ext, kind: 'model', size: m.blob.size, added: now - k * 3600000,
      file, thumb, preview: null, w: m.w, h: m.h, ar: m.ar, duration: 0, pages: 0,
      tags: ['3d'], folders: ['f-3d'], note: '', url: '', colors: m.colors, trashed: false, fresh: k === 0, fav: false,
      ...(m.verts ? { verts: m.verts, tris: m.tris } : {}),
    });
  });
  // materials: texture sets packed as .perchmat
  (await demoMaterials()).forEach((m, k) => {
    const id = 'demomat' + k, file = `files/${id}/${m.name}.perchmat`, thumb = m.thumb ? `files/${id}/thumb.webp` : null;
    put(`${ROOT}/${file}`, m.blob);
    if (thumb) put(`${ROOT}/${thumb}`, m.thumb);
    items.push({
      id, name: m.name, ext: 'perchmat', kind: 'material', size: m.blob.size, added: now - k * 4200000,
      file, thumb, preview: null, w: m.w, h: m.h, ar: m.ar, duration: 0, pages: 0,
      tags: ['материал'], folders: ['f-3d'], note: '', url: '', colors: m.colors, trashed: false, fresh: false, fav: false,
    });
  });
  // blocks of page layout, as the browser extension grabs them
  (await demoBlocks()).forEach((m, k) => {
    const id = 'demoblk' + k, file = `files/${id}/${m.name}.oddblock`, thumb = `files/${id}/thumb.webp`;
    put(`${ROOT}/${file}`, m.blob);
    put(`${ROOT}/${thumb}`, m.thumb);
    items.push({
      id, name: m.name, ext: 'oddblock', kind: 'block', size: m.blob.size, added: now - k * 2400000,
      file, thumb, preview: null, w: m.w, h: m.h, ar: m.ar, duration: 0, pages: 0,
      tags: m.tags, folders: [], note: '', url: m.url, colors: m.colors, trashed: false, fresh: k === 0, fav: false,
    });
  });
  // SVG icons: something to try «SVG в 3D» on (the picture is the SVG itself)
  DEMO_SVG.forEach(([name, color, d, rule], k) => {
    const id = 'demosvg' + k, file = `files/${id}/${name}.svg`;
    const blob = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512"><path fill="${color}"${rule ? ' fill-rule="evenodd"' : ''} d="${d}"/></svg>`], { type: 'image/svg+xml' });
    put(`${ROOT}/${file}`, blob);
    items.push({
      id, name, ext: 'svg', kind: 'image', size: blob.size, added: now - k * 5400000,
      file, thumb: file, preview: null, w: 512, h: 512, ar: 1, duration: 0, pages: 0,
      tags: ['иконка'], folders: ['f-icons'], note: '', url: '', colors: [color], trashed: false, fresh: false, fav: false,
    });
  });
  put(`${ROOT}/index.json`, new Blob([JSON.stringify({ version: 1, folders, items })]));
}
