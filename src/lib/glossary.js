// The team's tag dictionary: one word for one thing — «онбординг», not «onboarding», «Онбординг» and «онбординг » side by
// side. A tag being added becomes its dictionary form (a known synonym or the same word in another case / with ё / in
// Latin); typing gets suggestions from the dictionary first; «Найти похожие теги» proposes merges of what is already in
// the library. The dictionary is { canonical: [synonyms] } — the team's (oddments-team.json → glossary) or one's own.
// Pure: no DOM, no I/O (glossaryStore.js keeps it).

// the same word however typed: case, ё, spaces, a «#», Latin look-alikes
const LAT = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в' };
export const fold = (t) => String(t || '').trim().replace(/^#/, '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const shape = (t) => fold(t).replace(/[a-z]/g, (c) => (/[а-я]/.test(fold(t)) ? LAT[c] || c : c));

// a typed tag → the dictionary's word (or the typed one, cleaned)
export function canonical(tag, glossary = {}) {
  const f = shape(tag);
  if (!f) return '';
  for (const [c, syn] of Object.entries(glossary)) {
    if (shape(c) === f || (syn || []).some((s) => shape(s) === f)) return c;
  }
  return String(tag).trim().replace(/^#/, '').replace(/\s+/g, ' ');
}

// suggestions while typing: dictionary words (and those whose synonyms match) first, then the library's own tags
export function suggest(prefix, glossary = {}, libraryTags = [], n = 8) {
  const p = fold(prefix);
  if (!p) return [];
  const out = [];
  for (const [c, syn] of Object.entries(glossary)) if (fold(c).startsWith(p) || (syn || []).some((s) => fold(s).startsWith(p))) out.push(c);
  for (const t of libraryTags) if (fold(t).startsWith(p) && !out.some((x) => fold(x) === fold(t))) out.push(t);
  return out.slice(0, n);
}

// at most one letter added, dropped or changed
function near1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}

// tags of the library that are one word written differently: [{ keep, merge: [..] }]. The form to keep: the dictionary's
// if there is one, otherwise the most used (lower case wins a tie)
export function similarTags(counts, glossary = {}) {
  const groups = new Map();
  for (const [t, n] of counts) {
    const c = canonical(t, glossary);
    let k = shape(c);
    // one letter apart in a longer word is a typo or a spelling («кешбэк» / «кэшбэк», «кнопка» / «кнопки»): the same group
    if (!groups.has(k) && k.length >= 6) k = [...groups.keys()].find((g) => g.length >= 6 && near1(g, k)) || k;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([t, n]);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const dict = Object.keys(glossary).find((c) => list.some(([t]) => canonical(t, glossary) === c));
    const keep = dict || list.slice().sort((a, b) => b[1] - a[1] || (a[0] === a[0].toLowerCase() ? -1 : 1))[0][0];
    out.push({ keep, merge: list.map(([t]) => t).filter((t) => t !== keep), n: list.reduce((a, [, n]) => a + n, 0) });
  }
  return out.sort((a, b) => b.n - a.n);
}
