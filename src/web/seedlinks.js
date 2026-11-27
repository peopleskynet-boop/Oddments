// Demo links for the web build (seed.js): pages of 3D assets saved the way the browser extension and Claude save them — a
// .url with an [Oddments] section (title, description, site, icon, the page's picture as data:). Most come without
// `page`, so the start reads them like links saved before covers (ui/links.js coverOldLinks) through the real path
// (ingest.js genLink → linkpage.js); two are pages that gave no picture (the card with the name in big letters).
import { writeShortcut, hostOf, siteName } from '../lib/linkmeta.js';
import { linkCard } from '../lib/figma.js';

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rr = (x, l, t, w, h, r) => { x.beginPath(); x.roundRect(l, t, w, h, r); };

// a product render of a phone: back with the camera, front with the screen, on a soft studio backdrop
function phones(w, h, bg, body, screen) {
  const c = canvas(w, h), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w * 0.4, h); g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const glow = x.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.55);
  glow.addColorStop(0, 'rgba(255,255,255,.35)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = glow; x.fillRect(0, 0, w, h);
  const pw = Math.min(w * 0.26, h * 0.36), ph = pw * 2.05;
  const one = (cx, cy, rot, back) => {
    x.save(); x.translate(cx, cy); x.rotate(rot);
    x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = pw * 0.3; x.shadowOffsetY = pw * 0.12;
    x.fillStyle = body; rr(x, -pw / 2, -ph / 2, pw, ph, pw * 0.18); x.fill();
    x.shadowColor = 'transparent';
    const edge = x.createLinearGradient(-pw / 2, 0, pw / 2, 0); edge.addColorStop(0, 'rgba(255,255,255,.35)'); edge.addColorStop(0.5, 'rgba(255,255,255,0)'); edge.addColorStop(1, 'rgba(0,0,0,.18)');
    x.fillStyle = edge; rr(x, -pw / 2, -ph / 2, pw, ph, pw * 0.18); x.fill();
    if (back) {
      x.fillStyle = 'rgba(0,0,0,.18)'; rr(x, -pw * 0.4, -ph * 0.44, pw * 0.5, pw * 0.5, pw * 0.12); x.fill();
      for (const [dx, dy] of [[-0.27, -0.36], [-0.03, -0.36], [-0.15, -0.24]]) { x.fillStyle = '#16161a'; x.beginPath(); x.arc(pw * dx, ph * dy, pw * 0.085, 0, 7); x.fill(); x.fillStyle = 'rgba(120,140,200,.5)'; x.beginPath(); x.arc(pw * dx, ph * dy, pw * 0.04, 0, 7); x.fill(); }
    } else {
      const s = x.createLinearGradient(0, -ph / 2, 0, ph / 2); s.addColorStop(0, screen[0]); s.addColorStop(1, screen[1]);
      x.fillStyle = s; rr(x, -pw * 0.45, -ph * 0.47, pw * 0.9, ph * 0.94, pw * 0.14); x.fill();
      x.fillStyle = '#0b0b0d'; rr(x, -pw * 0.14, -ph * 0.44, pw * 0.28, pw * 0.08, pw * 0.04); x.fill();
      x.fillStyle = 'rgba(255,255,255,.85)'; rr(x, -pw * 0.33, -ph * 0.1, pw * 0.66, pw * 0.16, pw * 0.08); x.fill();
      x.fillStyle = 'rgba(255,255,255,.4)'; rr(x, -pw * 0.33, ph * 0.04, pw * 0.4, pw * 0.08, pw * 0.04); x.fill();
    }
    x.restore();
  };
  one(w * 0.42, h * 0.52, -0.16, true);
  one(w * 0.6, h * 0.5, 0.1, false);
  return c;
}

// a site's icon: a rounded square in its colour with its letter
function icon(color, letter, ink = '#fff') {
  const c = canvas(64, 64), x = c.getContext('2d');
  x.fillStyle = color; rr(x, 0, 0, 64, 64, 16); x.fill();
  x.fillStyle = ink; x.font = '700 36px "Golos Text Variable", "Segoe UI", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(letter, 32, 35);
  return c.toDataURL('image/png');
}

const LINKS = [
  { name: 'БЕСПЛАТНО iPhone 17 Pro - Ranguel, 51 тыс полигонов, CC BY, Sketchfab', url: 'https://sketchfab.com/3d-models/iphone-17-pro-4541aa8a28324b33a2baaf81d263aaec', title: 'iPhone 17 Pro - Download Free 3D model by Ranguel', desc: 'Free iPhone 17 Pro, 51k polygons, all four colours, CC Attribution.', site: 'Sketchfab', icon: ['#1caad9', 'S'], pic: [1280, 720, ['#dfe6ee', '#9fb1c6'], '#d9772e', ['#ff9d5c', '#c2410c']], tags: ['iphone', 'бесплатно', 'CC BY'] },
  { name: 'iPhone 18 Pro - KSTORE, Blender 5.2, 19 долл, editorial', url: 'https://www.renderhub.com/kstore/iphone-18-pro', title: 'iPhone 18 Pro - 3D Model by KSTORE', desc: 'A clean, detailed model of the iPhone 18 Pro Max, fully created in Blender 5.2.', site: 'RenderHub', icon: ['#e2462f', 'R'], pic: [900, 900, ['#2b2d33', '#121316'], '#c7ccd3', ['#3b82f6', '#1e3a8a']], tags: ['iphone', 'blender', 'editorial'] },
  { name: 'iPhone 17 Pro - iMeshh, по подписке, editorial', url: 'https://imeshh.com/assets/iphone-17-pro', title: 'iPhone 17 Pro 3D Model - Blender, glTF, D5', desc: 'iPhone 17 Pro in the orange colourway, 20,883 polygons with an embossed glass back.', site: '', icon: ['#111111', 'i'], pic: [1200, 900, ['#f3e4d7', '#e3b48f'], '#e0782f', ['#ffd1a8', '#f97316']], tags: ['iphone', 'blender'] },
  { name: 'iPhone 18 Pro Glacier - dika3d, blend, текстуры 4K, 20 долл, royalty free', url: 'https://superhivemarket.com/products/apple-iphone-18-pro-glacier', title: 'Apple iPhone 18 Pro Glacier', desc: 'A Unique Market for Creators that love Blender', site: 'Superhive (formerly Blender Market)', icon: ['#f5b301', 'S', '#1b1b1b'], pic: [1200, 800, ['#e8f1f8', '#b9cfe2'], '#cfe1ef', ['#a5c8e6', '#4f7fa8']], tags: ['iphone', 'blender', 'royalty free'] },
  { name: 'Pixel 11 Pro Olive - DIKA3D, blend, текстуры 4K, 22.5 долл, standard license', url: 'https://www.artstation.com/marketplace/p/3LAqv/google-pixel-11-pro-olive', title: 'Google Pixel 11 Pro Olive', desc: 'Blend file, 4K textures, Cycles and EEVEE.', site: 'ArtStation', icon: ['#13aff0', 'A'], pic: [1280, 720, ['#2e3427', '#11140e'], '#7c8a5c', ['#b7c48f', '#4d5a2f']], tags: ['pixel', 'blender'] },
  { name: 'Додо - ролик про приложение 2024, телефон 3D, интерфейс крупно', url: 'https://t.me/designdodo/418', title: 'Dodo Design', desc: 'Делимся, как сделали ролик про новое приложение: 3D-телефон, интерфейс крупным планом.', site: 'Telegram', icon: ['#2aabee', 'T'], pic: [1080, 1350, ['#ff6a3d', '#c2410c'], '#1d1d1f', ['#fff4ec', '#ffd8c2']], tags: ['моушн', 'app promo'] },
];
// pages that gave no picture (Rotato's blog has no og:image; Dribbble answers a bot with a challenge)
const BARE = [
  { name: 'Rotato - 14 приёмов видео-мокапов с примерами', url: 'https://rotato.app/blog/mockup-video-examples', desc: '14 video mockup ideas and examples', site: 'Rotato', icon: ['#7c5cff', 'R'], tint: '#7c5cff', tags: ['моушн', 'приёмы'] },
  { name: 'Solide - 3D-анимация финансового приложения (Dribbble, не смотрел)', url: 'https://dribbble.com/shots/27868946', desc: '', site: 'dribbble', icon: null, tint: '', tags: ['финтех', 'не проверено'] },
];

// [{ id, name, file blob, thumb?, page?, tags }] for seed.js to put on the demo disk
export async function demoLinks() {
  const out = [];
  LINKS.forEach((l, k) => {
    const [w, h, bg, body, screen] = l.pic;
    const text = writeShortcut({ url: l.url, title: l.title, desc: l.desc, site: l.site, icon: icon(...l.icon), image: phones(w, h, bg, body, screen).toDataURL('image/jpeg', 0.82) });
    out.push({ id: 'demolnk' + k, name: l.name, blob: new Blob([text], { type: 'application/x-url' }), tags: l.tags });
  });
  for (const [k, l] of BARE.entries()) {
    const card = linkCard(l.url, 640, 480, { title: l.name, site: siteName(l.url, l.site), tint: l.tint });
    const thumb = await new Promise((r) => card.toBlob(r, 'image/webp', 0.82));
    const ic = l.icon ? await (await fetch(icon(...l.icon))).blob() : null;
    out.push({
      id: 'demolnkb' + k, name: l.name, blob: new Blob([writeShortcut({ url: l.url })], { type: 'application/x-url' }), tags: l.tags, thumb, icon: ic,
      page: { cover: '', title: '', desc: l.desc, site: siteName(l.url, l.site), host: hostOf(l.url), tint: l.tint, at: Date.now() },
    });
  }
  return out;
}
