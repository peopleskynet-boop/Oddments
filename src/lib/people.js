// «Люди» in the feed: designers, 3D and motion artists and studios followed through their OPEN channels — YouTube,
// Vimeo, Bluesky, Behance, Substack, Medium, Mastodon, personal blogs. Instagram, X, Threads and LinkedIn have no
// open feeds and forbid scraping: their posts go in through the browser extension, by hand.
// The starter list was checked on 20.10.2026: every feed below answered with fresh items. The person's own list
// lives in localStorage['perch.people'] ({ added, removed }); a link to any profile or site finds its feed (discover).
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { readSource } from './feed.js';
import { channelName, CHANNELS } from './telegram.js';
import { readPref, writePref } from './prefs.js';

const yt = (id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
export const STARTER = [
  { id: 'blenderguru', name: 'Andrew Price', role: 'Blender Guru · уроки Blender', topic: '3d', kind: 'YouTube', url: 'https://www.youtube.com/@blenderguru', feed: yt('UCOKHwx1VCdgnxwbjyb9Iu1g') },
  { id: 'ianhubert', name: 'Ian Hubert', role: 'VFX и 3D в Blender', topic: '3d', kind: 'YouTube', url: 'https://www.youtube.com/@IanHubert2', feed: yt('UCbmxZRQk-X0p-TOxd6PEYJA') },
  { id: 'defaultcube', name: 'Default Cube', role: 'Blender: процедурка, геоноды', topic: '3d', kind: 'YouTube', url: 'https://www.youtube.com/@DefaultCube', feed: yt('UCdpWKLNfbROyoGPV46-zaUQ') },
  { id: 'cgmatter', name: 'CGMatter', role: 'Blender: приёмы и эксперименты', topic: '3d', kind: 'YouTube', url: 'https://www.youtube.com/@CGMatter', feed: yt('UCy1f4m64dwCwk8CBZ_vHfPg') },
  { id: 'polygonrunway', name: 'Polygon Runway', role: 'стилизованное 3D', topic: '3d', kind: 'YouTube', url: 'https://www.youtube.com/@PolygonRunway', feed: yt('UCGSJevmBuDyxjLLOBNaYMGA') },
  { id: 'ducky3d', name: 'Ducky 3D', role: 'абстрактное 3D и моушн', topic: '3d', kind: 'YouTube', url: 'https://www.youtube.com/@Ducky3D', feed: yt('UCaQ8E_v3uMivfuiPGelrs0g') },
  { id: 'blenderstudio', name: 'Blender Studio', role: 'фильмы и пайплайн Blender', topic: '3d', kind: 'YouTube', url: 'https://www.youtube.com/@BlenderStudio', feed: yt('UCz75RVbH8q2jdBJ4SnwuZZQ') },
  { id: 'thefutur', name: 'Chris Do', role: 'The Futur · бренд и бизнес дизайна', topic: 'design', kind: 'YouTube', url: 'https://www.youtube.com/@thefutur', feed: yt('UC-b3c7kxa5vU-bnmaROgvog') },
  { id: 'fluxacademy', name: 'Ran Segall', role: 'Flux Academy · веб-дизайн', topic: 'design', kind: 'YouTube', url: 'https://www.youtube.com/@FluxAcademy', feed: yt('UCN7dywl5wDxTu1RM3eJ_h9Q') },
  { id: 'designcourse', name: 'Gary Simon', role: 'DesignCourse · UI и вёрстка', topic: 'ux', kind: 'YouTube', url: 'https://www.youtube.com/@DesignCourse', feed: yt('UCVyRiMvfUNMA1UPlDPzG5Ow') },
  { id: 'kevinpowell', name: 'Kevin Powell', role: 'CSS и интерфейсы', topic: 'ux', kind: 'YouTube', url: 'https://www.youtube.com/@Kevin_Powell', feed: yt('UC1QA_dGfEGnTZDtX7JAICAA') },
  { id: 'figma', name: 'Figma', role: 'новое в Figma, конференции', topic: 'ux', kind: 'YouTube', url: 'https://www.youtube.com/@Figma', feed: yt('UCQsVmhSa4X-G3lHlUtejzLA') },
  { id: 'schoolofmotion', name: 'School of Motion', role: 'моушн-дизайн', topic: 'motion', kind: 'YouTube', url: 'https://www.youtube.com/@schoolofmotion', feed: yt('UCAhdxqdrDN3gWJkaUFl9G-Q') },
  { id: 'buck', name: 'BUCK', role: 'студия анимации и дизайна', topic: 'motion', kind: 'Vimeo', url: 'https://vimeo.com/buck', feed: 'https://vimeo.com/buck/videos/rss' },
  { id: 'oddfellows', name: 'Oddfellows', role: 'студия моушн-дизайна', topic: 'motion', kind: 'Vimeo', url: 'https://vimeo.com/oddfellows', feed: 'https://vimeo.com/oddfellows/videos/rss' },
  { id: 'chimero', name: 'Frank Chimero', role: 'дизайнер, эссе о ремесле', topic: 'design', kind: 'Блог', url: 'https://frankchimero.com', feed: 'https://frankchimero.com/feed.xml' },
  { id: 'vanschneider', name: 'Tobias van Schneider', role: 'DESK Magazine · о карьере дизайнера', topic: 'design', kind: 'Блог', url: 'https://vanschneider.com', feed: 'https://vanschneider.com/feed' },
  { id: 'pablostanley', name: 'Pablo Stanley', role: 'иллюстрация, UI, инструменты', topic: 'design', kind: 'Substack', url: 'https://pablostanley.substack.com', feed: 'https://pablostanley.substack.com/feed' },
  { id: 'juliezhuo', name: 'Julie Zhuo', role: 'The Looking Glass · продукт и команда', topic: 'ux', kind: 'Substack', url: 'https://lg.substack.com', feed: 'https://lg.substack.com/feed' },
  { id: 'lukew', name: 'Luke Wroblewski', role: 'продуктовый дизайн, ИИ в интерфейсах', topic: 'ux', kind: 'Блог', url: 'https://www.lukew.com', feed: 'https://www.lukew.com/ff/rss.php' },
  { id: 'joshcomeau', name: 'Josh W. Comeau', role: 'интерактивные интерфейсы, CSS', topic: 'ux', kind: 'Блог', url: 'https://www.joshwcomeau.com', feed: 'https://www.joshwcomeau.com/rss.xml' },
  { id: 'bradfrost', name: 'Brad Frost', role: 'Atomic Design, дизайн-системы', topic: 'ux', kind: 'Bluesky', url: 'https://bsky.app/profile/bradfrost.com', feed: 'https://bsky.app/profile/bradfrost.com/rss' },
  { id: 'nngroup', name: 'Nielsen Norman Group', role: 'исследования UX', topic: 'ux', kind: 'Блог', url: 'https://www.nngroup.com', feed: 'https://www.nngroup.com/feed/rss/' },
];

const KEY = 'perch.people';
const load = () => readPref(KEY, { added: [], removed: [] });
const save = (s) => writePref(KEY, s);

export const people = () => { const s = load(); return [...s.added, ...STARTER.filter((p) => !s.removed.includes(p.id) && !s.added.some((a) => a.id === p.id))]; };
// as feed sources: the person's name is the «source», everything goes under the «Люди» topic
export const peopleSources = () => people().map((p) => ({ id: 'p-' + p.id, name: p.name, url: p.feed, topic: 'people', person: p.id, ...(p.telegram ? { telegram: p.telegram } : {}) }));
export function removePerson(id) { const s = load(); s.added = s.added.filter((p) => p.id !== id); if (STARTER.some((p) => p.id === id)) s.removed = [...new Set([...s.removed, id])]; save(s); }
export function restoreStarter() { const s = load(); s.removed = []; save(s); }
function addPerson(p) { const s = load(); s.added = [p, ...s.added.filter((x) => x.id !== p.id)]; s.removed = s.removed.filter((x) => x !== p.id); save(s); }

/* ---------- a link → the person's open feed ---------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Oddments';
const page = async (url) => { const r = await tfetch(url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en' } }); if (!r.ok) throw new Error('страница ответила ' + r.status); return r.text(); };
const CLOSED = /(^|\.)(instagram\.com|x\.com|twitter\.com|threads\.net|threads\.com|linkedin\.com|facebook\.com|tiktok\.com)$/i;
const NO_FEED = /(^|\.)(dribbble\.com|artstation\.com|pinterest\.[a-z.]+)$/i;

// the candidates for a link, most likely first: a known pattern, else what the page announces, else common paths
async function candidates(raw) {
  const u = new URL(raw);
  const host = u.hostname.replace(/^www\./, '').toLowerCase(), path = u.pathname.replace(/\/+$/, '');
  if (CLOSED.test(host)) throw new Error('у этой сети нет открытых лент — их посты сохраняйте расширением (Alt+клик)');
  if (NO_FEED.test(host)) throw new Error('у ' + host + ' больше нет лент авторов — добавьте их YouTube, Behance, Bluesky или сайт');
  if (/youtube\.com$/.test(host) || host === 'youtu.be') {
    const m = path.match(/\/channel\/(UC[\w-]{20,})/);
    if (m) return [{ feed: `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`, kind: 'YouTube' }];
    const html = await page(raw);
    const id = (html.match(/"externalId":"(UC[\w-]+)"/) || html.match(/channel_id=(UC[\w-]+)/) || [])[1];
    if (!id) throw new Error('не нашёл канал по этой ссылке');
    return [{ feed: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, kind: 'YouTube' }];
  }
  if (host === 'bsky.app') { const h = (path.match(/\/profile\/([^/]+)/) || [])[1]; if (h) return [{ feed: `https://bsky.app/profile/${h}/rss`, kind: 'Bluesky', url: `https://bsky.app/profile/${h}` }]; }
  if (host === 'behance.net') { const user = path.split('/').filter(Boolean)[0]; if (user && user !== 'gallery') return [{ feed: `https://www.behance.net/feeds/user?username=${user}`, kind: 'Behance' }]; }
  if (host === 'vimeo.com') { const user = path.split('/').filter(Boolean)[0]; if (user && !/^\d+$/.test(user)) return [{ feed: `https://vimeo.com/${user}/videos/rss`, kind: 'Vimeo' }]; }
  if (host === 'medium.com') { const user = path.split('/').filter(Boolean)[0]; if (user && user.startsWith('@')) return [{ feed: `https://medium.com/feed/${user}`, kind: 'Medium' }]; }
  if (/\.substack\.com$/.test(host)) return [{ feed: `https://${host}/feed`, kind: 'Substack', url: `https://${host}` }];
  if (/^\/@[\w.]+$/.test(path)) return [{ feed: `https://${host}${path}.rss`, kind: 'Mastodon' }]; // Mastodon and friends: /@user → /@user.rss
  // a site: the feed it announces, then the usual places
  const out = [];
  try {
    const d = new DOMParser().parseFromString(await page(raw), 'text/html');
    d.querySelectorAll('link[rel~="alternate"][type*="rss"], link[rel~="alternate"][type*="atom"]').forEach((l) => { try { out.push({ feed: new URL(l.getAttribute('href'), raw).href, kind: 'Блог' }); } catch (e) { /* bad href */ } });
  } catch (e) { /* the page did not open: try the usual paths anyway */ }
  for (const p of ['/feed', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/rss']) out.push({ feed: u.origin + p, kind: 'Блог' });
  return out;
}

// → the added person; throws with a reason in plain words
export async function discover(raw, onStep = () => {}) {
  raw = raw.trim();
  // a Telegram channel: t.me/name, t.me/s/name or @name — read through its public web preview (telegram.js)
  const tg = /t(elegram)?\.me\//i.test(raw) || /^@[A-Za-z]/.test(raw) ? channelName(raw) : '';
  if (tg) {
    if (CHANNELS.some((c) => c.telegram.toLowerCase() === tg.toLowerCase())) throw new Error('@' + tg + ' уже в ленте — он из стартового списка каналов');
    onStep('Читаю канал…');
    const src = { id: 'probe', name: '', url: `https://t.me/s/${tg}`, topic: 'people', telegram: tg };
    let items = [];
    try { items = await readSource(src); } catch (e) { /* below */ }
    if (!items.length) throw new Error('канал закрыт или пуст — читаются только открытые каналы');
    let name = '@' + tg;
    try {
      const r = await tfetch(src.url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'text/html' } });
      const t = new DOMParser().parseFromString(await r.text(), 'text/html').querySelector('meta[property="og:title"]');
      if (t && t.getAttribute('content')) name = t.getAttribute('content').slice(0, 60);
    } catch (e) { /* keep @name */ }
    const p = { id: 'tg-' + tg.toLowerCase(), name, role: '@' + tg, topic: 'people', kind: 'Telegram', url: `https://t.me/${tg}`, feed: src.url, telegram: tg, mine: true };
    addPerson(p);
    return p;
  }
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let url;
  try { url = new URL(raw).href; } catch (e) { throw new Error('это не похоже на ссылку'); }
  onStep('Ищу открытую ленту…');
  for (const c of await candidates(url)) {
    try {
      const xml = await (await tfetch(c.feed, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } })).text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      if (doc.getElementsByTagName('parsererror').length) continue;
      const items = await readSource({ id: 'probe', name: '', url: c.feed, topic: 'people' }).catch(() => []);
      if (!items.length) continue;
      const title = (doc.querySelector('channel > title, feed > title, title') || {}).textContent || '';
      // «@handle - Name» (Bluesky), «Vimeo / Name’s videos», «Stories by Name on Medium»
      const name = title.replace(/^@\S+\s+-\s+/, '').replace(/^Vimeo \/ (.+?)’s videos$/, '$1').replace(/^Stories by (.+) on Medium$/, '$1').trim().slice(0, 60) || new URL(url).hostname;
      const id = 'u' + [...c.feed].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7).toString(36).replace('-', 'n');
      const p = { id, name, role: c.kind === 'Блог' ? new URL(url).hostname.replace(/^www\./, '') : c.kind, topic: 'people', kind: c.kind, url: c.url || url, feed: c.feed, mine: true };
      addPerson(p);
      return p;
    } catch (e) { /* the next candidate */ }
  }
  throw new Error('у этой страницы не нашлось открытой ленты');
}
