// The daily digest (Сводка дня): what was notable in AI and in design over the last day — not everything.
// AI candidates: Denis Trends (popularity across Hacker News, GitHub, LessWrong, Lobsters, Replicate — by Denis
// Shiryaev), Hugging Face Daily Papers (upvotes), r/LocalLLaMA (top of the day), The Verge, TechCrunch, MIT Technology
// Review, Ars Technica, OpenAI, Google AI, the HF blog, Simon Willison and the AI Telegram channels; a cross-check
// against the editors' digests TLDR AI and The Rundown AI. Design: the feed's sources (Telegram channels included),
// Fast Company Co.Design, Creative Boom, Sidebar. «Notable»: several outlets on one story, mentioned by the editors,
// trend points / upvotes, a channel post with far more views than usual. With the Anthropic key Claude (one request a
// day, ~ $0.05 with Sonnet) picks 5–7 stories per section and retells them in Russian; without it the digest is
// ranked by those signals alone, in the sources' words. Kept as <library>/news/digest-YYYY-MM-DD.json.
import * as fs from '@tauri-apps/plugin-fs';
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { absPath } from './library.js';
import { SOURCES, readSource } from './feed.js';

export const AI_SOURCES = [
  // popularity across Hacker News, GitHub, LessWrong, Lobsters, Replicate on one scale — Denis Trends by Denis Shiryaev
  // (Denis Sexy IT), https://shir-man.com/homepage/; replaces raw Hacker News (it is inside) — bug #56
  { id: 'trends', name: 'Denis Trends', url: 'https://shir-man.com/api/rss?sort=day', topic: 'ai', points: true },
  { id: 'hfpapers', name: 'HF Daily Papers', url: 'https://huggingface.co/api/daily_papers?limit=40', topic: 'ai', hfPapers: true },
  { id: 'localllama', name: 'r/LocalLLaMA', url: 'https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day', topic: 'ai' },
  { id: 'verge-ai', name: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', topic: 'ai' },
  { id: 'techcrunch-ai', name: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', topic: 'ai' },
  { id: 'mittr-ai', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', topic: 'ai' },
  { id: 'ars-ai', name: 'Ars Technica', url: 'https://arstechnica.com/ai/feed/', topic: 'ai' },
  { id: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml', topic: 'ai' },
  { id: 'google-ai', name: 'Google AI', url: 'https://blog.google/technology/ai/rss/', topic: 'ai' },
  { id: 'hf', name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', topic: 'ai' },
  { id: 'willison', name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', topic: 'ai' },
];
const DESIGN_EXTRA = [
  { id: 'fastco', name: 'Fast Company', url: 'https://www.fastcompany.com/co-design/rss', topic: 'design' },
  { id: 'creativeboom', name: 'Creative Boom', url: 'https://www.creativeboom.com/feed/', topic: 'design' },
  { id: 'sidebar', name: 'Sidebar', url: 'https://sidebar.io/feed.xml', topic: 'design' }, // five best design links a day, by votes
];
// editors' AI digests: not candidates, a cross-check — a story they mention is notable (AINews by smol.ai was the
// first choice, but its feed stopped on 9 Sep 2026)
const REFS = [
  { id: 'tldr-ai', name: 'TLDR AI', url: 'https://tldr.tech/api/rss/ai' },
  { id: 'rundown', name: 'The Rundown AI', url: 'https://www.therundown.ai/feed' },
];
// the feed's sources split by side: Telegram channels about AI go to «ИИ», the rest of the feed to «Дизайн»
const DESIGN_SOURCES = [...SOURCES.filter((s) => s.id !== 'vimeo' && s.topic !== 'ai'), ...DESIGN_EXTRA];
const AI_ALL = [...AI_SOURCES, ...SOURCES.filter((s) => s.topic === 'ai')];
const DAY = 864e5, WINDOW = 1.5 * DAY;

const PREFS = 'perch.digest';
export const digestPrefs = () => { try { return { auto: false, model: 'claude-sonnet-5-5', ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch (e) { return { auto: false, model: 'claude-sonnet-5-5' }; } };
export const setDigestPrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify({ ...digestPrefs(), ...p })); } catch (e) { /* private */ } };

const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const file = (key) => absPath(`news/digest-${key}.json`);
export async function loadDigest(key = dayKey()) { try { return JSON.parse(await fs.readTextFile(file(key))); } catch (e) { return null; } }
export async function digestDays() {
  try { return (await fs.readDir(absPath('news'))).map((e) => (e.name.match(/^digest-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort().reverse(); } catch (e) { return []; }
}
export const today = dayKey;

/* ---------- candidates and the «notable» signals ---------- */
const STOP = new Set('the a an and or of to in on for with from by at is are be as its it this that new how why what your you we our into over after about vs via — – - — и в на с по для из от что как это'.split(' '));
const words = (t) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const similar = (a, b) => { let n = 0; a.forEach((w) => { if (b.has(w)) n++; }); return n / Math.max(1, Math.min(a.size, b.size)); };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Oddments';
// Hugging Face's papers of the day (JSON): the community's upvotes are the signal
async function hfPapers(src) {
  const r = await tfetch(src.url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).map((d) => {
    const p = d.paper || d;
    return { id: 'hfp-' + p.id, source: src.id, sourceName: src.name, topic: 'ai', title: p.title || '', text: String(p.summary || '').slice(0, 600),
      link: 'https://huggingface.co/papers/' + p.id, date: Date.parse(d.publishedAt || p.publishedAt) || Date.now(), image: d.thumbnail || '', upvotes: p.upvotes || 0 };
  }).filter((x) => x.title);
}
async function readAny(s) { return s.hfPapers ? hfPapers(s) : readSource(s); }
// the editors' digests as plain text, to look stories up in
async function refsText() {
  const out = [];
  await Promise.all(REFS.map(async (s) => {
    try {
      const r = await tfetch(s.url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml' } });
      const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
      const items = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagName('entry')].filter((e) => Date.now() - (Date.parse((e.getElementsByTagName('pubDate')[0] || e.getElementsByTagName('updated')[0] || {}).textContent) || 0) < WINDOW);
      const text = items.map((e) => e.textContent).join(' ');
      if (text) out.push({ name: s.name, words: words(new DOMParser().parseFromString('<body>' + text + '</body>', 'text/html').body.textContent || text) });
    } catch (e) { /* a digest that did not answer: no cross-check from it */ }
  }));
  return out;
}

async function gather(sources, onProgress) {
  const got = [], failed = [];
  const queue = sources.slice();
  let done = 0;
  const worker = async () => { for (let s; (s = queue.shift());) { try { got.push(...(await readAny(s)).map((x) => ({ ...x, hn: s.hn || s.points }))); } catch (e) { failed.push(s.name); } onProgress(++done, failed); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { items: got.filter((x) => Date.now() - x.date < WINDOW), failed };
}
// stories told by several sites are one story: grouped by shared title words; the group remembers its sites and points
function cluster(items, refs = []) {
  const groups = [];
  for (const x of items) {
    const w = words(x.title);
    const g = groups.find((gr) => similar(gr.w, w) >= 0.5);
    const points = x.hn ? +((x.text.match(/(?:Points|Score):\s*(\d+)/) || [])[1] || 0) : x.upvotes ? x.upvotes * 4 : 0;
    const hot = x.hot || 0; // Telegram: views against the channel's usual (2 = twice as many as a typical post)
    if (g) { g.items.push(x); g.sites.add(x.sourceName); g.points = Math.max(g.points, points); g.hot = Math.max(g.hot, hot); }
    else groups.push({ w, items: [x], sites: new Set([x.sourceName]), points, hot });
  }
  // an editors' digest mentions it: most of the story's title words are in their text
  groups.forEach((g) => { const ws = [...g.w].filter((w) => w.length > 3); g.refs = ws.length >= 2 ? refs.filter((r) => ws.filter((w) => r.words.has(w)).length / ws.length >= 0.6).map((r) => r.name) : []; });
  return groups.map((g) => ({ ...g, score: (g.sites.size - 1) * 3 + g.refs.length * 2 + (g.points ? Math.log10(g.points) * 2 : 0) + (g.hot > 1.3 ? Math.min(3, (g.hot - 1) * 2) : 0) + (Date.now() - g.items[0].date < DAY ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);
}

/* ---------- making the digest ---------- */
export async function makeDigest(onProgress = () => {}) {
  const all = [...AI_ALL, ...DESIGN_SOURCES];
  let seen = 0;
  const prog = (d, failed) => onProgress(`Читаю источники · ${++seen} из ${all.length}${failed.length ? ' · не ответили: ' + failed.length : ''}`);
  const [ai, design, refs] = await Promise.all([gather(AI_ALL, prog), gather(DESIGN_SOURCES, prog), refsText()]);
  const groups = { ai: cluster(ai.items, refs).slice(0, 60), design: cluster(design.items).slice(0, 60) };
  if (!groups.ai.length && !groups.design.length) throw new Error('источники не ответили — проверьте интернет');
  const { aiPrefs } = await import('./iconai.js');
  const key = aiPrefs().key;
  let sections, by = 'signals';
  if (key) {
    onProgress('ИИ выбирает главное…');
    try { sections = await withClaude(groups, key); by = 'claude'; } catch (e) { console.warn('digest:', e); onProgress('ИИ не ответил — собираю по популярности'); }
  }
  if (!sections) sections = bySignals(groups);
  const d = { day: dayKey(), at: Date.now(), by, sections, sources: all.length, failed: [...ai.failed, ...design.failed] };
  await fs.mkdir(absPath('news'), { recursive: true });
  await fs.writeTextFile(file(d.day), JSON.stringify(d));
  return d;
}

const storyOf = (g) => ({
  title: g.items[0].title, summary: g.items[0].text.replace(/Article URL:.*$/s, '').slice(0, 280), why: g.sites.size > 1 ? `пишут ${g.sites.size} издания` : g.refs && g.refs.length ? `есть в ${g.refs.join(' и ')}` : g.items[0].upvotes ? `${g.items[0].upvotes} голосов на Hugging Face` : g.points ? (g.items[0].source === 'trends' ? `в топе Denis Trends за день · ${g.points} очков` : `${g.points} голосов на Hacker News`) : g.hot > 1.3 ? `просмотров в ${String(g.hot).replace('.', ',')} раза больше обычного у канала` : '',
  image: (g.items.find((x) => x.image) || {}).image || '', links: g.items.slice(0, 4).map((x) => ({ site: x.sourceName, url: x.link, title: x.title })),
});
function bySignals(groups) {
  return [{ id: 'ai', title: 'ИИ', stories: groups.ai.slice(0, 6).map(storyOf) }, { id: 'design', title: 'Дизайн', stories: groups.design.slice(0, 6).map(storyOf) }];
}

async function withClaude(groups, key) {
  const brief = (gs) => gs.map((g, i) => ({ i, title: g.items[0].title, text: g.items[0].text.replace(/Article URL:.*$/s, '').slice(0, 220), sites: [...g.sites], points: g.points || undefined, in_editors_digests: g.refs && g.refs.length ? g.refs : undefined, views_vs_usual: g.hot || undefined }));
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  headers['anthropic-dangerous-direct-browser-access'] = 'true'; // the exe sends an Origin too (bug #110)
  const r = await tfetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({
    model: digestPrefs().model, max_tokens: 4000,
    system: `Ты редактор утренней сводки для дизайнера (3D, интерфейсы, графика), который следит за ИИ. Из кандидатов за сутки выбери ЗАМЕТНОЕ: релизы и крупные обновления моделей и инструментов, важные исследования, громкие события индустрии; в дизайне — сильные проекты, новые инструменты, тренды, обсуждаемые кейсы. Мелочь, рекламу, повторы и общие IT-новости без связи с ИИ пропускай. «sites», «in_editors_digests» (упомянуто в редакторских ИИ-дайджестах TLDR AI / The Rundown), «points» (Denis Trends — популярность сразу на Hacker News, GitHub, LessWrong, Lobsters, Replicate; у статей Hugging Face — голоса сообщества ×4) и «views_vs_usual» (просмотры поста в Telegram-канале относительно обычных для канала) — сигналы популярности. Посты из Telegram-каналов — мнения практиков: бери их, если это заметное событие или сильная работа, а не личная заметка.
Ответ — только JSON: {"ai":[{"i":номер,"title":"заголовок по-русски","summary":"2–3 предложения по-русски: что случилось и почему это важно","why":"коротко, почему заметно"}],"design":[...]} — по 5–7 историй в разделе, самые важные первыми.`,
    messages: [{ role: 'user', content: JSON.stringify({ ai: brief(groups.ai), design: brief(groups.design) }) }],
  }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
  const t = (j.content || []).map((c) => c.text || '').join('');
  const m = t.match(/\{[\s\S]*\}/);
  const pick = JSON.parse(m ? m[0] : '{}');
  const build = (id, title, gs, chosen) => ({ id, title, stories: (chosen || []).filter((c) => gs[c.i]).slice(0, 7).map((c) => ({ ...storyOf(gs[c.i]), title: c.title || gs[c.i].items[0].title, summary: c.summary || '', why: c.why || storyOf(gs[c.i]).why })) });
  const sections = [build('ai', 'ИИ', groups.ai, pick.ai), build('design', 'Дизайн', groups.design, pick.design)];
  if (!sections.some((s) => s.stories.length)) throw new Error('пустой ответ');
  return sections;
}

// once a day, when it is on: after 8 in the morning, if today's digest is not there yet
export async function digestDue() {
  if (!digestPrefs().auto || new Date().getHours() < 8) return false;
  return !(await loadDigest());
}
