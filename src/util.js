// Small helpers used everywhere: DOM shortcuts ($, $$), escaping (esc), ids, sizes and dates in the interface's
// language, plural forms, colour conversions (hexRGB, inkOn — black or white text on a colour), platform checks (isMac).
import { lang } from './lib/i18n.js';
// numbers as the interface's language writes them: «2,5» and «7 172» in Russian, «2.5» and «7,172» in English
export const DEC = lang === 'en' ? '.' : ',';
export const LOC = lang === 'en' ? 'en-GB' : 'ru-RU';
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
// what a file is, in words a person reads: our own formats by their meaning (audit 24.10: «PERCHMAT», «ODDBLOCK»
// leaked into the inspector and the screen reader), the rest by extension
const OWN_TYPES = { perchmat: 'Материал', oddblock: 'Блок интерфейса' };
export const typeLabel = (it) => OWN_TYPES[(it.ext || '').toLowerCase()] || (it.ext || it.kind || '').toUpperCase();

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function fmtSize(n) {
  if (n < 1024) return n + ' Б';
  // Russian decimal comma: 3,8 МБ
  if (n < 1048576) return (n / 1024).toFixed(0) + ' КБ';
  if (n < 1073741824) return (n / 1048576).toFixed(1).replace('.', DEC) + ' МБ';
  return (n / 1073741824).toFixed(2).replace('.', DEC) + ' ГБ';
}

export function fmtDur(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(r).padStart(2, '0');
}

export function plural(n, forms) {
  const m = n % 10, c = n % 100;
  return m === 1 && c !== 11 ? forms[0] : m >= 2 && m <= 4 && (c < 10 || c >= 20) ? forms[1] : forms[2];
}

export const dateFmt = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });

export function hexRGB(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// black or white, whichever reads better on this colour (WCAG contrast against the colour's luminance)
export function inkOn(h) {
  const L = hexRGB(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? '#111' : '#fff';
}
// macOS: no AutoRemesher build there, Cmd instead of Ctrl for the palette (Cmd+Space is Spotlight)
// a full-screen layer over the app (plugins, a flow review, the storyboard, SVG → 3D / icons, the feed, the news):
// what lies under it must not react to the pointer (bug #111)
export const layerOpen = () => typeof document !== 'undefined' && document.body.matches('.plg-on, .flow-on, .story-on, .s3d-on, .feed-on, .news-on');
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '');
export function toHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function colorDist(a, b) {
  const x = hexRGB(a), y = hexRGB(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
export function isDarkColor(hex) {
  const [r, g, b] = hexRGB(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 150;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function raf(fn) {
  let id = 0;
  return (...a) => { if (id) return; id = requestAnimationFrame(() => { id = 0; fn(...a); }); };
}

export const baseName = (p) => p.split(/[\\/]/).pop();
export function splitName(file) {
  const i = file.lastIndexOf('.');
  if (i <= 0) return { name: file, ext: '' };
  return { name: file.slice(0, i), ext: file.slice(i + 1).toLowerCase() };
}
export const safeFile = (s) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'file';
