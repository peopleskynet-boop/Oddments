// Saved articles (раздел «Новости»): a page is fetched by the app, its readable part taken out by Mozilla
// Readability (the same engine as Firefox's reader view, Apache 2.0), cleaned by DOMPurify (no scripts, no
// handlers, no frames) and kept in the library folder — <library>/news/index.json (the list) and
// <library>/news/<id>.json (the text). Pictures stay links to the site. index.json of the library is not touched.
import * as fs from '@tauri-apps/plugin-fs';
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { absPath } from './library.js';
import { lang } from './i18n.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Oddments';
const dir = () => absPath('news');
const listFile = () => absPath('news/index.json');
const bodyFile = (id) => absPath(`news/${id}.json`);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

let list = null, listOf = '';
export async function articles() {
  if (list && listOf === listFile()) return list; // another library: its own list
  listOf = listFile();
  try { list = JSON.parse(await fs.readTextFile(listFile())); } catch (e) { list = []; }
  return list;
}
async function writeList() {
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeTextFile(listFile() + '.tmp', JSON.stringify(list));
  await fs.rename(listFile() + '.tmp', listFile());
}
export const isSaved = (url) => !!(list && list.some((a) => a.url === url));

// the readable part of a page: title, author, text as clean HTML, the lead picture
async function readable(url) {
  const r = await tfetch(url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } });
  if (!r.ok) throw new Error('сайт ответил ' + r.status);
  return readableFrom(await r.text(), url);
}
// the largest picture of a srcset («a.jpg 400w, b.jpg 1200w» → b.jpg)
const largest = (set) => (set || '').split(/,\s+(?=\S)/).map((c) => c.trim().split(/\s+/)).filter((c) => c[0])
  .sort((a, b) => (parseFloat(b[1]) || 1) - (parseFloat(a[1]) || 1))[0]?.[0] || '';
// a paywall cut: the site sent only the beginning (Medium's member-only stories, «subscribe to continue»…) — bug #67
const PAYWALL = /member-only story|access to everything|upgrade now|subscribe to (continue|read)|this story is for members|become a member to read|только для подписчиков|оформите подписку, чтобы/i;
export function readableFrom(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // pictures sites hide from Readability: <noscript> fallbacks (Medium), srcset / data-srcset, <picture> sources
  doc.querySelectorAll('noscript').forEach((n) => { if (/<img/i.test(n.textContent)) { const t = doc.createElement('div'); t.innerHTML = n.textContent; n.replaceWith(...t.childNodes); } });
  doc.querySelectorAll('img').forEach((img) => {
    const big = largest(img.getAttribute('srcset') || img.getAttribute('data-srcset')) || img.getAttribute('data-src') || '';
    const pic = img.closest('picture');
    const fromPic = pic ? largest([...pic.querySelectorAll('source')].map((s) => s.getAttribute('srcset') || '').join(', ')) : '';
    const best = big || fromPic;
    const cur = img.getAttribute('src') || '';
    if (best && (!cur || /^data:/.test(cur) || /\b(\d{1,2})\/|resize:fill:\d{1,2}:|w=\d{1,2}\b|blur/i.test(cur))) img.setAttribute('src', best);
  });
  const paywall = PAYWALL.test(doc.body ? doc.body.textContent : '');
  return readDoc(doc, url, paywall);
}
async function readDoc(doc, url, paywall) {
  // relative links and pictures made absolute by hand: a <base> breaks the app's CSP (base-uri 'self', bug #121)
  const abs = (u) => { try { return new URL(u, url).href; } catch (e) { return u; } };
  doc.querySelectorAll('[href], [src], [poster], [data-src]').forEach((n) => { for (const a of ['href', 'src', 'poster', 'data-src']) { const v = n.getAttribute(a); if (v && !/^(#|data:|blob:|javascript:|mailto:)/i.test(v)) n.setAttribute(a, abs(v)); } });
  doc.querySelectorAll('[srcset]').forEach((n) => n.setAttribute('srcset', n.getAttribute('srcset').split(',').map((p) => { const [u, ...w] = p.trim().split(/\s+/); return [abs(u), ...w].join(' '); }).join(', ')));
  const og = (p) => { const m = doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`); return m ? m.getAttribute('content') || '' : ''; };
  const image = og('og:image') || og('twitter:image');
  const published = Date.parse(og('article:published_time')) || 0;
  const { Readability } = await import('@mozilla/readability');
  const a = new Readability(doc, { charThreshold: 300 }).parse();
  if (!a || !a.content) throw new Error('на странице не нашлось статьи');
  return { title: a.title, byline: a.byline || '', site: a.siteName || '', html: a.content, text: a.textContent || '', excerpt: a.excerpt || '', image, published, paywall };
}

// clean HTML: links open outside, pictures lazy and from absolute addresses, nothing that runs
async function clean(html, url) {
  const DOMPurify = (await import('dompurify')).default;
  const safe = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'], FORBID_ATTR: ['style', 'class', 'id'] });
  const d = new DOMParser().parseFromString('<body>' + safe + '</body>', 'text/html');
  const abs = (u) => { try { return new URL(u, url).href; } catch (e) { return ''; } };
  d.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (!src || /^data:image\/(gif|svg)/.test(src) && src.length < 400) { img.remove(); return; }
    img.setAttribute('src', abs(src));
    img.removeAttribute('srcset'); img.removeAttribute('sizes');
    img.setAttribute('loading', 'lazy'); img.setAttribute('referrerpolicy', 'no-referrer');
  });
  d.querySelectorAll('a[href]').forEach((a) => { const h = abs(a.getAttribute('href')); if (/^https?:/i.test(h)) a.setAttribute('href', h); else a.removeAttribute('href'); });
  // a site's little icons (an arrow «opens in new tab», a link glyph) have no size of their own and would fill the
  // column (bug #95): decorative ones go, the rest are sized like a letter in the reader's styles
  d.querySelectorAll('svg').forEach((s) => { if (s.getAttribute('aria-hidden') === 'true' || s.closest('a')) s.remove(); });
  d.querySelectorAll('span, small').forEach((s) => { if (/^\(?opens in (a )?new (tab|window)\)?$/i.test((s.textContent || '').trim())) s.remove(); });
  return d.body.innerHTML;
}

// → the saved article's card. hint: what the feed already knows (title, picture, text) — used when the page cannot be read
// html: the page as the person's own browser shows it (the extension's «Сохранить статью в Oddments» — a site they are
// logged in to gives them the whole article); without it the app fetches the page itself
export async function saveArticle(url, hint = {}, html = '') {
  await articles();
  const have = list.find((a) => a.url === url);
  if (have && !html) return have;
  if (have) await removeArticle(have.id); // the browser's copy (maybe the full one) replaces the earlier
  let page, partial = false;
  try { page = html ? await readableFrom(html, url) : await readable(url); } catch (e) {
    if (!hint.title) throw e;
    partial = true; // the site did not let us read it: keep what the feed had, the link opens the rest
    page = { title: hint.title, byline: '', site: hint.site || '', html: `<p>${(hint.text || '').replace(/</g, '&lt;')}</p>`, text: hint.text || '', excerpt: hint.text || '', image: hint.image || '', published: hint.date || 0 };
  }
  const body = await clean(page.html, url);
  const words = (page.text.match(/\S+/g) || []).length;
  const id = hash(url);
  const card = {
    id, url, title: (page.title || hint.title || url).trim().slice(0, 300), site: page.site || hint.site || new URL(url).hostname.replace(/^www\./, ''),
    byline: page.byline, image: page.image || hint.image || '', excerpt: (page.excerpt || page.text).replace(/\s+/g, ' ').trim().slice(0, 280),
    published: page.published || hint.date || 0, savedAt: Date.now(), minutes: Math.max(1, Math.round(words / 200)), partial, paywall: !!page.paywall, read: false,
  };
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeTextFile(bodyFile(id), JSON.stringify({ html: body }));
  list.unshift(card);
  await writeList();
  return card;
}

export async function articleBody(id) {
  try { return JSON.parse(await fs.readTextFile(bodyFile(id))); } catch (e) { return { html: '<p>Текст статьи не нашёлся на диске.</p>' }; }
}
export async function updateArticle(id, patch) {
  await articles();
  const a = list.find((x) => x.id === id);
  if (a) { Object.assign(a, patch); await writeList(); }
}
export async function saveBody(id, body) { await fs.writeTextFile(bodyFile(id), JSON.stringify(body)); }
export async function removeArticle(id) {
  await articles();
  list = list.filter((a) => a.id !== id);
  await writeList();
  try { await fs.remove(bodyFile(id)); } catch (e) { /* already gone */ }
}

// The interface's language, through Claude: the article's blocks (headings, paragraphs, list items, quotes) in order, a few at a time
export async function translateBlocks(blocks, onProgress = () => {}) {
  const { aiPrefs } = await import('./iconai.js');
  const key = aiPrefs().key;
  if (!key) throw new Error('Нужен ключ Anthropic: Настройки › «Ключ Anthropic»');
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  headers['anthropic-dangerous-direct-browser-access'] = 'true'; // the exe sends an Origin too (bug #110)
  const out = [];
  for (let i = 0; i < blocks.length;) {
    const part = [];
    let size = 0;
    while (i < blocks.length && (size < 5000 || !part.length)) { part.push(blocks[i]); size += blocks[i].length; i++; }
    const r = await tfetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({
      model: 'claude-haiku-5-5', max_tokens: 8000,
      system: `Переведи ${lang === 'en' ? 'на английский' : 'на русский'} каждый фрагмент статьи о дизайне или технологиях: точно, живо, без пояснений, термины и названия продуктов не переводи. Ответ — только JSON-массив строк той же длины и в том же порядке.`,
      messages: [{ role: 'user', content: JSON.stringify(part) }],
    }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 401 ? 'ключ не подошёл' : (j.error && j.error.message) || 'HTTP ' + r.status);
    const t = (j.content || []).map((c) => c.text || '').join('');
    const m = t.match(/\[[\s\S]*\]/);
    const arr = m ? JSON.parse(m[0]) : [];
    part.forEach((p, k) => out.push(typeof arr[k] === 'string' ? arr[k] : p));
    onProgress(out.length, blocks.length);
  }
  return out;
}
