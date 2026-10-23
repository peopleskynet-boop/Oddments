// Demo blocks of page layout (.oddblock, lib/block.js) for the web build: the markup is written here in the shape the
// browser extension saves it (computed styles inline), the shot is the same markup drawn through an SVG foreignObject.
import { zipSync, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';

const FONT = "font-family:'Golos Text Variable','Segoe UI',system-ui,sans-serif";
const BLOCKS = [
  {
    name: 'Карточка «Pro» — example.com', kind: 'Карточка', w: 360, h: 420, bg: '#f4f2ee', tags: ['Карточка', 'example.com', 'Светлый'],
    fonts: [{ family: 'Golos Text', weight: 600, size: 28, chars: 3 }, { family: 'Golos Text', weight: 400, size: 15, chars: 120 }],
    colors: [{ hex: '#ffffff', role: 'фон' }, { hex: '#1d1d22', role: 'текст' }, { hex: '#5b4cff', role: 'фон' }],
    html: `<div style="${FONT};box-sizing:border-box;width:360px;height:420px;padding:28px;border-radius:24px;background:#ffffff;box-shadow:0 18px 40px rgba(20,20,40,.12);color:#1d1d22;display:flex;flex-direction:column;gap:14px">
      <span style="align-self:flex-start;padding:5px 12px;border-radius:99px;background:#efedff;color:#5b4cff;font-size:12px;font-weight:600">Популярный</span>
      <h3 style="margin:0;font-size:28px;font-weight:600;letter-spacing:-.02em">Pro</h3>
      <p style="margin:0;font-size:15px;line-height:1.5;color:#5d5d66">Всё для команды: общие подборки, история правок и поиск по смыслу.</p>
      <div style="display:flex;align-items:baseline;gap:6px;margin-top:6px"><b style="font-size:44px;font-weight:700;letter-spacing:-.03em">990 ₽</b><span style="font-size:14px;color:#8a8a93">в месяц</span></div>
      <ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.9;color:#3b3b44"><li>До 10 человек</li><li>100 ГБ на диске</li><li>Поддержка за час</li></ul>
      <a href="https://example.com/pro" style="margin-top:auto;height:48px;border-radius:14px;background:#5b4cff;color:#fff;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;text-decoration:none">Попробовать бесплатно</a>
    </div>`,
  },
  {
    name: 'Навигация — studio.test', kind: 'Навигация', w: 720, h: 72, bg: '#0e0f13', tags: ['Навигация', 'studio.test', 'Тёмный'],
    fonts: [{ family: 'Golos Text', weight: 500, size: 15, chars: 40 }],
    colors: [{ hex: '#0e0f13', role: 'фон' }, { hex: '#d7ff63', role: 'фон' }, { hex: '#e9e9ee', role: 'текст' }],
    html: `<nav style="${FONT};box-sizing:border-box;width:720px;height:72px;padding:0 20px;background:#0e0f13;color:#e9e9ee;display:flex;align-items:center;gap:28px;font-size:15px;font-weight:500">
      <b style="font-size:18px;font-weight:700;letter-spacing:-.02em">studio</b>
      <a href="#" style="color:#e9e9ee;text-decoration:none">Работы</a><a href="#" style="color:#9a9aa3;text-decoration:none">Команда</a><a href="#" style="color:#9a9aa3;text-decoration:none">Журнал</a>
      <a href="#" style="margin-left:auto;height:40px;padding:0 18px;border-radius:99px;background:#d7ff63;color:#0e0f13;font-weight:600;display:flex;align-items:center;text-decoration:none">Обсудить проект</a>
    </nav>`,
  },
];

async function shotOf(b) {
  const doc = `<div xmlns="http://www.w3.org/1999/xhtml" style="background:${b.bg};width:${b.w}px;height:${b.h}px">${b.html.replace(/&(?!amp;)/g, '&amp;')}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w * 2}" height="${b.h * 2}"><foreignObject width="${b.w}" height="${b.h}" transform="scale(2)">${doc}</foreignObject></svg>`;
  const im = new Image();
  im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await im.decode();
  const c = document.createElement('canvas');
  c.width = b.w * 2; c.height = b.h * 2;
  const x = c.getContext('2d');
  x.fillStyle = b.bg; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(im, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

export async function demoBlocks() {
  const out = [];
  for (const b of BLOCKS) {
    try {
      const shot = await shotOf(b);
      const meta = { v: 1, url: 'https://' + b.tags[1] + '/', site: b.tags[1], kind: b.kind, name: b.name, w: b.w, h: b.h, shotW: b.w, shotH: b.h, scale: 2, background: b.bg, fonts: b.fonts, colors: b.colors };
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${b.name}</title><style>html,body{margin:0}body{background:${b.bg}}</style></head><body>${b.html}</body></html>`;
      const blob = new Blob([zipSync({ 'shot.png': new Uint8Array(await shot.arrayBuffer()), 'block.html': strToU8(html), 'block.json': strToU8(JSON.stringify(meta)) }, { level: 0 })], { type: 'application/x-oddments-block' });
      const { blockCover } = await import('../lib/block.js');
      const cover = blockCover(await createImageBitmap(shot), b.bg);
      const thumb = await new Promise((r) => cover.toBlob(r, 'image/webp', 0.85));
      out.push({ name: b.name, blob, thumb, w: b.w, h: b.h, ar: cover.height / cover.width, tags: b.tags, colors: b.colors.map((c) => c.hex), url: meta.url });
    } catch (e) { console.warn('demo block', e); }
  }
  return out;
}
