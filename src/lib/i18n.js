// English for the interface. The app is written in Russian; with English chosen (Settings › Вид › «Язык»), what the
// interface shows is translated as it appears: text, and the title / aria-label / placeholder / alt attributes.
// The dictionary (i18n-en.json) is generated from the source's Russian strings: a plain string is matched whole;
// a template («Шаг {0} из {1}») becomes a pattern whose parts are translated and whose values are carried over (and
// translated too when they are dictionary words, as «3 файла» → «3 files»). The user's own content — file names, tags,
// collection names, feed posts and articles — is never in the dictionary, so it stays as it is. Canvas drawings and
// the Blender add-on / Figma plugin stay Russian for now.
// The dictionary (~140 KB) is loaded only when English is chosen: a Russian start does not carry it (it sat in the
// startup code — a quarter of it).

const KEY = 'perch.lang';
export const LANGS = [['ru', 'Русский'], ['en', 'English']];
export const lang = (() => {
  // Russian unless chosen: WebView2 reports en-US on a Russian Windows (checked in the exe), so the system's language
  // cannot be trusted to mean the person's
  try { return localStorage.getItem(KEY) || 'ru'; } catch (e) { return 'ru'; }
})();
export function setLang(l) { try { localStorage.setItem(KEY, l); } catch (e) { /* private mode */ } location.reload(); }

// word forms the templates put next to numbers (plural() picks them at run time), and a few short labels
const EXTRA = {
  'файл': 'file', 'файла': 'files', 'файлов': 'files', 'тег': 'tag', 'тега': 'tags', 'тегов': 'tags',
  'подборка': 'collection', 'подборки': 'collections', 'подборок': 'collections', 'новый': 'new', 'новых': 'new', 'новое': 'new',
  'шаг': 'step', 'шага': 'steps', 'шагов': 'steps', 'экран': 'screen', 'экрана': 'screens', 'экранов': 'screens',
  'иконка': 'icon', 'иконки': 'icons', 'иконок': 'icons', 'вариант': 'variant', 'варианта': 'variants', 'вариантов': 'variants',
  'меш': 'mesh', 'меша': 'meshes', 'мешей': 'meshes', 'картинка': 'picture', 'картинки': 'pictures', 'картинок': 'pictures',
  'статья': 'article', 'статьи': 'articles', 'статей': 'articles', 'модель': 'model', 'модели': 'models', 'моделей': 'models',
  'издание': 'outlet', 'издания': 'outlets', 'изданий': 'outlets', 'источник': 'source', 'источника': 'sources', 'источников': 'sources',
  'запись': 'post', 'записи': 'posts', 'записей': 'posts', 'выбрано': 'selected', 'мин': 'min', 'с': 's', 'ч': 'h',
  'Знакомство': 'Getting started', 'Готово — Oddments ваш': 'Done — Oddments is yours', 'Скрыть, разберусь сам': 'Hide, I will figure it out', 'Ещё': 'More',
  'Закрыть': 'Close', 'Свернуть окно': 'Minimise', 'Закрыть окно': 'Close', 'Язык · Language': 'Language', 'Язык интерфейса · Interface language': 'Interface language',
};
const CYR = /[А-Яа-яЁё]/;
const norm = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const exact = new Map();
const patterns = [];
function build(EN) {
for (const [k, v] of Object.entries(EXTRA)) if (!(k in EN)) EN[k] = v;
for (const [ru, en] of Object.entries(EN)) {
  // keys come from the source as written: «\\» there is one backslash on screen
  const k = norm(ru.replace(/&nbsp;/g, ' ').replace(/\\\\/g, '\\'));
  const v = en.replace(/&nbsp;/g, ' ').replace(/\\\\/g, '\\');
  if (!/\{\d+\}/.test(k)) { exact.set(k, v); continue; }
  const order = [...k.matchAll(/\{(\d+)\}/g)].map((m) => +m[1]);
  const parts = k.split(/\{\d+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // the literal part must carry real Russian words, or the pattern would catch anything
  if (parts.join('').replace(/[^А-Яа-яЁё]/g, '').length < 3) continue;
  // a value never begins or ends inside a Russian word («{5} мин{6}» must not eat «38 минут»)
  let src = '^' + parts[0];
  for (let i = 1; i < parts.length; i++) {
    const before = /[А-Яа-яЁё]$/.test(parts[i - 1]) ? '(?![А-Яа-яЁё])' : '', after = /^[А-Яа-яЁё]/.test(parts[i]) ? '(?<![А-Яа-яЁё])' : '';
    src += before + '(.*?)' + after + parts[i];
  }
  patterns.push({ re: new RegExp(src + '$'), order, en: v, hint: parts.reduce((a, b) => (b.length > a.length ? b : a), '').replace(/\\/g, '') });
}
}

const word = (s) => exact.get(norm(s)) ?? s;
export function tr(s) {
  if (!s || !CYR.test(s)) return s;
  const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0], k = norm(s);
  const hit = exact.get(k);
  if (hit != null) return lead + hit + tail;
  for (const p of patterns) {
    if (p.hint && !k.includes(p.hint)) continue;
    const m = k.match(p.re);
    if (!m) continue;
    const vals = {};
    p.order.forEach((n, i) => { vals[n] = m[i + 1]; });
    return lead + p.en.replace(/\{(\d+)\}/g, (_, n) => (vals[n] != null ? tr(vals[n]) : '')) + tail;
  }
  // «3 файла», «12 подборок»: a number and a dictionary word
  const nw = k.match(/^([\d\s.,~≈+]+)\s*(\S+)$/);
  if (nw && exact.has(nw[2])) return lead + nw[1].trim() + ' ' + exact.get(nw[2]) + tail;
  // «3 из 5»
  const of = k.match(/^(\d+) из (\d+)$/);
  if (of) return lead + of[1] + ' of ' + of[2] + tail;
  // «Тема: Марафон» (a label and its value, as the custom selects name themselves), «Папка библиотеки: /путь»
  const ci = k.indexOf(': ');
  if (ci > 0) { const a = k.slice(0, ci), b = k.slice(ci + 2), tb = tr(b); let ta = tr(a); if (ta === a) { const w = tr(a + ':'); if (w !== a + ':') ta = w.replace(/:\s*$/, ''); } if (ta !== a || tb !== b) return lead + ta + ': ' + tb + tail; }
  // «Типографика, 10 файлов» / «Недавние, новых: 18» (the left panel's rows for a screen reader): a name and a count
  const nc = k.match(/^(.+), (\d+ \S+|новых: \d+)$/);
  if (nc) { const a = tr(nc[1]), b = tr(nc[2]); if (a !== nc[1] || b !== nc[2]) return lead + a + ', ' + b + tail; }
  // «155 файлов · 5,1 МБ»: pieces joined by a middle dot, each on its own
  if (k.includes(' · ')) { const parts = k.split(' · '), out = parts.map(tr); if (out.some((x, i) => x !== parts[i])) return lead + out.join(' · ') + tail; }
  return s;
}
export const t = (s) => (lang === 'en' ? tr(s) : s);

// what is never translated: the user's own words, and the cards (also the busiest part of the screen)
const SKIP = '.card, .nw-article, .reel-txt, .reel-t, .rd-body, textarea, [contenteditable], .cj-c, .boot2 .b2-word';
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];

function attrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute && el.getAttribute(a);
    if (v && CYR.test(v)) { const n = tr(v); if (n !== v) el.setAttribute(a, n); }
  }
}
function walk(root) {
  if (root.nodeType === 3) {
    const p = root.parentElement;
    if (p && !p.closest(SKIP) && CYR.test(root.data)) { const n = tr(root.data); if (n !== root.data) root.data = n; }
    return;
  }
  if (root.nodeType !== 1 || root.closest(SKIP)) return;
  attrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 1) attrs(n);
    else if (CYR.test(n.data)) { const v = tr(n.data); if (v !== n.data) n.data = v; }
  }
}

export async function initI18n() {
  document.documentElement.lang = lang;
  if (lang !== 'en') return;
  build((await import('./i18n-en.json')).default);
  walk(document.body);
  document.title = tr(document.title);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') walk(m.target);
      else if (m.type === 'attributes' && !m.target.closest(SKIP)) attrs(m.target);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
