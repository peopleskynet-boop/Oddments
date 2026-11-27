// A saved link (.url) and what its page says about itself: the picture, the title, the description, the site's name
// and icon. Pure text work, no network and no DOM (tests/unit/linkmeta.test.mjs); the fetching is in linkpage.js.
//
// The shortcut may carry what the browser extension or Claude saw on the page, in a section Windows does not read:
//   [InternetShortcut]
//   URL=https://www.artstation.com/marketplace/p/3LAqv/…
//   [Oddments]
//   Title=Google Pixel 11 Pro Olive
//   Description=Blend, 4K textures…
//   Image=https://cdna.artstation.com/…/cover.jpg   (or data:image/jpeg;base64,… — a shot of the page)
//   Site=ArtStation
//   Icon=https://www.artstation.com/favicon-32x32.png
// It wins over what Oddments reads from the page itself: sites behind Cloudflare (ArtStation) or a bot wall (Dribbble)
// answer Oddments with a challenge, the person's browser saw the real page.

const IMAGE_OK = /^(https?:\/\/|data:image\/(png|jpe?g|webp|gif|avif);base64,)/i;
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

export function readShortcut(text) {
  const out = { url: '', image: '', title: '', desc: '', site: '', icon: '' };
  let sec = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const s = /^\[(.+)\]$/.exec(line);
    if (s) { sec = s[1].trim().toLowerCase(); continue; }
    const m = /^([A-Za-z]+)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (sec === 'internetshortcut' && k === 'url' && !out.url) out.url = v;
    else if (sec === 'oddments') {
      if (k === 'image' && IMAGE_OK.test(v)) out.image = v;
      else if (k === 'icon' && IMAGE_OK.test(v)) out.icon = v;
      else if (k === 'title') out.title = clip(v, 300);
      else if (k === 'description') out.desc = clip(v, 500);
      else if (k === 'site') out.site = clip(v, 40);
    }
  }
  // a shortcut written without sections: the first URL= line, as before
  if (!out.url) { const m = /^\s*URL\s*=(.+)$/im.exec(String(text || '')); if (m) out.url = m[1].trim(); }
  return out;
}

// the same shortcut back as text (the demo library, the tests; the extension writes its own copy of this)
export function writeShortcut({ url, image = '', title = '', desc = '', site = '', icon = '' }) {
  const one = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
  const extra = [['Title', title], ['Description', desc], ['Site', site], ['Icon', icon], ['Image', image]].filter(([, v]) => one(v));
  return `[InternetShortcut]\r\nURL=${one(url)}\r\n` + (extra.length ? '[Oddments]\r\n' + extra.map(([k, v]) => `${k}=${one(v)}\r\n`).join('') : '');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', copy: '©', reg: '®', trade: '™' };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function attrs(tag) {
  const a = {}, re = /([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) a[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return a;
}
const abs = (u, base) => { u = String(u || '').trim(); if (!u) return ''; try { const x = new URL(u.startsWith('//') ? 'https:' + u : u, base || undefined); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };

// the page's own words about itself, from its <head>: Open Graph, Twitter cards, <title>, the icons
export function pageMeta(html, base) {
  const head = String(html || '').slice(0, 800000);
  const end = head.search(/<\/head\s*>|<body[\s>]/i);
  const h = end > 0 ? head.slice(0, end) : head;
  const meta = {}, icons = [];
  for (const tag of h.match(/<(meta|link)\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    if (/^<meta/i.test(tag)) {
      const k = (a.property || a.name || a.itemprop || '').toLowerCase();
      if (k && a.content != null && !(k in meta)) meta[k] = a.content;
    } else {
      const rel = (a.rel || '').toLowerCase().split(/\s+/);
      if (a.href && (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed'))) icons.push({ rel, href: a.href, sizes: a.sizes || '', type: (a.type || '').toLowerCase() });
      if (a.href && rel.includes('image_src') && !('image_src' in meta)) meta.image_src = a.href;
    }
  }
  const tm = /<title[^>]*>([^<]*)<\/title>/i.exec(h);
  const pick = (...keys) => { for (const k of keys) if (meta[k] && meta[k].trim()) return meta[k]; return ''; };
  return {
    title: clip(decodeEntities(pick('og:title', 'twitter:title') || (tm ? decodeEntities(tm[1]) : '')), 300),
    desc: clip(pick('og:description', 'twitter:description', 'description'), 500),
    site: clip(pick('og:site_name', 'application-name', 'apple-mobile-web-app-title'), 60),
    image: abs(pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src', 'image_src'), base),
    icon: bestIcon(icons, base),
  };
}

// the sharpest icon the page names: an apple-touch-icon (180 px PNG), then a PNG or SVG icon by its size, then any;
// none named — the site's /favicon.ico
export function bestIcon(icons, base) {
  const size = (s) => { const m = /(\d+)x\d+/i.exec(s || ''); return m ? +m[1] : 0; };
  const score = (i) => {
    if (i.rel.includes('apple-touch-icon') || i.rel.includes('apple-touch-icon-precomposed')) return 300;
    const px = size(i.sizes), vec = i.type.includes('svg') || /\.svg(\?|$)/i.test(i.href);
    return (vec ? 250 : Math.min(px, 256)) + (/\.ico(\?|$)/i.test(i.href) || i.type.includes('icon') ? 0 : 10);
  };
  const best = icons.filter((i) => abs(i.href, base)).sort((a, b) => score(b) - score(a))[0];
  if (best) return abs(best.href, base);
  try { return new URL('/favicon.ico', base).href; } catch (e) { return ''; }
}

// the host as people say it: no «www.»
export function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch (e) { return ''; } }

// the short name on the card's pill: the site's own name when it is short («Sketchfab», «9to5Google»), else the domain
// without its zone («renderhub», «superhivemarket»; «t.me» stays whole)
const SLD = /^(co|com|net|org|gov|edu|ac)$/i;
export function siteName(url, own = '') {
  own = String(own || '').trim();
  if (own && own.length <= 20 && !/[|–—]/.test(own)) return own;
  const host = hostOf(url);
  if (!host) return '';
  const parts = host.split('.');
  if (parts.length < 2) return host;
  const cut = parts.length > 2 && SLD.test(parts[parts.length - 2]) ? 3 : 2;
  const name = parts[parts.length - cut];
  return name.length <= 2 ? parts.slice(-cut).join('.') : name;
}

// an auto-made name the page's title may replace: empty, the domain, or «YouTube abc123» (a title that did not come)
export function placeholderName(name, url) {
  const n = String(name || '').trim().toLowerCase(), host = hostOf(url);
  if (!n || n === 'без названия' || n === 'untitled') return true;
  if (host && (n === host || n === 'www.' + host || n === host.replace(/\.[a-z]+$/, ''))) return true;
  return /^(youtube|vimeo|pinterest) [\w-]+$/i.test(n);
}
