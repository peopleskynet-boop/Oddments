import { screenWords } from './screenwords.js';
import { S, ui, KINDS, folderById, descend, recentSet } from '../state.js';
import { okDist } from './palette.js';
import { similarity, SIM_MIN } from './similar.js';
import { viewTransition } from '../ui/motion.js';
import { aiSearch, meaningRank } from './ai.js';

// the AI scores of the phrase in the search box, when they are for this phrase (ai.js fills them in)
const semScores = () => (S.aiScores && S.aiQ === S.q.trim() ? S.aiScores : null);

export function viewTitle() {
  const v = S.view;
  switch (v.type) {
    case 'all': return 'Все файлы';
    case 'nofolder': return 'Без подборки';
    case 'notag': return 'Без тегов';
    case 'trash': return 'Корзина';
    case 'recent': return 'Недавние';
    case 'new': return 'Новые';
    case 'fav': return 'Избранное';
    case 'similar': { const it = S.byId.get(v.id); return it ? 'Похожие на «' + it.name + '»' : 'Похожие'; }
    case 'kind': return KINDS[v.id] ? KINDS[v.id].label : 'Файлы';
    case 'tag': return '#' + v.id;
    case 'folder': { const f = folderById(v.id); return f ? f.name : 'Подборка'; }
    case 'team': { const t = (S.teams || []).find((x) => x.id === v.id); return t ? t.name : 'Команда'; }
    default: return '';
  }
}

// The search text and the colour filter as one test; the type tabs count with it too, so their numbers match
// what a click on them will show.
// Russian endings change («рука с наушниками» → «рука держит наушники»): the words of a phrase are compared with the
// AI description by their stems, short words («с», «на», «для») are skipped
const SKIP = new Set(['для', 'над', 'под', 'без', 'или', 'при', 'про', 'это', 'как', 'его', 'она', 'они']);
const stem = (w) => (w.length > 6 ? w.slice(0, w.length - 3) : w.length > 4 ? w.slice(0, w.length - 2) : w.length > 3 ? w.slice(0, 3) : w);
export function stemsHit(parts, text) {
  const words = parts.filter((p) => p.length > 2 && !SKIP.has(p));
  return words.length > 0 && words.every((p) => text.includes(stem(p)));
}

// `ocr` — the text read on the picture (ocr.js): a screenshot is found by what is written on it
export const hayOf = (i) => (i.name + ' ' + i.tags.join(' ') + ' ' + (i.aiTags || []).join(' ') + ' ' + i.note + ' ' + i.url + ' ' + i.ext + ' ' + (i.ocr || '') + (i.pii && i.pii.length ? ' личные данные' : '') + (i.masked ? ' без личных данных' : '') + (i.scr ? ' ' + screenWords(i.scr) : '') + (i.notes ? ' ' + i.notes.map((n) => n.text).join(' ') : '')).toLowerCase().replace(/ё/g, 'е');

export function matchesQuery() {
  const parts = S.q.trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  const lim = 0.05 + S.colorTol * 0.0022; // tolerance 0..100 → an OKLab distance 0.05..0.27 (perceptual, palette.js)
  const sem = semScores(), min = S.aiMin || 0;
  return (i) => {
    if (parts.length) {
      const hay = hayOf(i);
      // by the words in its name and tags, or by what is in the picture (AI search: vectors, or the AI description)
      if (!parts.every((p) => hay.includes(p)) && !(sem && (sem.get(i.id) ?? -1) >= min)
        && !(i.aiDesc && stemsHit(parts, (i.aiDesc + ' ' + (i.aiTags || []).join(' ')).toLowerCase()))) return false;
    }
    return !S.color || i.colors.some((c) => okDist(c, S.color) < lim);
  };
}

export function computeVisible() {
  const v = S.view;
  let a = v.type === 'team' ? S.teamItems.filter((i) => i.team === v.id && !i.trashed) : S.items.filter((i) => (v.type === 'trash' ? i.trashed : !i.trashed));
  // a search over everything finds the team's files too (marked on the card, team.js)
  if (v.type === 'all' && S.q.trim() && S.teamItems.length) a = a.concat(S.teamItems.filter((i) => !i.trashed));
  if (v.type === 'folder') { const ids = descend(v.id); a = a.filter((i) => i.folders.some((f) => ids.has(f))); }
  else if (v.type === 'nofolder') a = a.filter((i) => !i.folders.length);
  else if (v.type === 'notag') a = a.filter((i) => !i.tags.length);
  else if (v.type === 'tag') a = a.filter((i) => i.tags.includes(v.id) || (i.aiTags || []).includes(v.id)); // own or AI tag (bug #91)
  else if (v.type === 'kind') a = a.filter((i) => i.kind === v.id);
  else if (v.type === 'new') a = a.filter((i) => i.fresh);
  else if (v.type === 'fav') a = a.filter((i) => i.fav);
  else if (v.type === 'similar') { const src = S.byId.get(v.id); a = src ? a.filter((i) => i !== src && similarity(src, i) > SIM_MIN) : []; }
  else if (v.type === 'recent') { const r = recentSet(); a = a.filter((i) => r.has(i.id)); }

  if (S.q.trim()) aiSearch(S.q);
  if (S.q.trim() || S.color) a = a.filter(matchesQuery());
  // how many of the results only the AI found (not by their words): the search box says «по смыслу: N»
  S.aiHits = 0;
  if (S.q.trim()) { const parts = S.q.trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/); S.aiHits = a.filter((i) => !parts.every((p) => hayOf(i).includes(p))).length; }
  // a search by meaning is ranked by meaning: the closest pictures first (word matches count as close)
  const sem = S.q.trim() && v.type !== 'similar' ? semScores() : null;
  if (sem) {
    const parts = S.q.trim().toLowerCase().split(/\s+/);
    const key = new Map(a.map((i) => {
      const hay = (i.name + ' ' + i.tags.join(' ') + ' ' + i.note).toLowerCase();
      return [i.id, (sem.get(i.id) ?? 0) + (parts.every((p) => hay.includes(p)) ? 1 : 0)];
    }));
    a.sort((x, y) => key.get(y.id) - key.get(x.id));
    S.vis = a;
    return a;
  }

  if (v.type === 'similar') {
    const src = S.byId.get(v.id);
    if (src) a.sort((x, y) => similarity(src, y) - similarity(src, x));
    S.vis = a;
    return a;
  }
  // a flow (a screen recording cut into screens, flows.js): its steps in order, whatever the sort
  const flow = v.type === 'folder' && folderById(v.id);
  if (flow && flow.flow && flow.order) {
    const at = new Map(flow.order.map((id, i) => [id, i]));
    a.sort((x, y) => (at.get(x.id) ?? 1e9) - (at.get(y.id) ?? 1e9) || x.added - y.added);
    S.vis = a;
    return a;
  }
  const k = S.sort, d = S.dir;
  // «По смыслу (ИИ)»: similar pictures next to each other; files the AI has not studied go after them, newest first
  const rank = k === 'ai' ? meaningRank() : null;
  if (rank) {
    const last = rank.size;
    a.sort((x, y) => ((rank.get(x.id) ?? last) - (rank.get(y.id) ?? last)) * (d < 0 ? 1 : -1) || y.added - x.added);
    S.vis = a;
    return a;
  }
  a.sort((x, y) => {
    let r;
    if (k === 'name') r = x.name.localeCompare(y.name, 'ru', { numeric: true });
    else if (k === 'size') r = x.size - y.size;
    else if (k === 'kind') r = x.kind.localeCompare(y.kind) || x.ext.localeCompare(y.ext);
    else r = x.added - y.added;
    return r * d || y.added - x.added;
  });
  S.vis = a;
  return a;
}

export function setView(type, id) {
  S.view = { type, id: id || null };
  S.sel.clear();
  S.last = null;
  document.body.classList.remove('nav-open');
  viewTransition(() => ui.refresh());
}
